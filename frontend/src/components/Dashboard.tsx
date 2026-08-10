import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { BaseError, encodeFunctionData, formatUnits } from 'viem';
import {
  CONTRACTS,
  REWARD_DISTRIBUTOR_ADDRESS,
  TESTNET_ORACLE,
  V2_CONTRACTS,
  lendingPoolAbi,
  priceOracleAbi,
  rewardDistributorAbi,
  stakingVaultAbi,
  stakingVaultV2Abi,
} from '../config/contracts';
import { CountUp } from './CountUp';
import { TokenIcon } from './TokenIcon';
import { HealthFactorGauge } from './HealthFactorGauge';
import { InfoTip } from './InfoTip';
import { usePositions, type StakePosition } from '../hooks/usePositions';
import { useV2Positions, type V2StakePosition } from '../hooks/useV2Positions';
import { useV2PositionRewards, type V2PositionRewardState } from '../hooks/useV2PositionRewards';
import { useV2Loans } from '../hooks/useV2Loans';
import {
  usePositionRewards,
  type PositionRewardState,
} from '../hooks/usePositionRewards';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { formatRewardDisplay, MIN_CLAIMABLE_REWARD } from '../lib/rewards';
import { StakeDrawer } from './StakeDrawer';
import { BorrowDrawer } from './BorrowDrawer';
import { RepayDrawer } from './RepayDrawer';
import { V2RepayDrawer } from './V2RepayDrawer';

const MAX_HF_THRESHOLD = 1_000_000;
const TIER_LABELS = ['Flexible', 'Growth', 'Diamond'];

function tokenSymbol(asset: string): 'USDC' | 'EURC' {
  return asset.toLowerCase() === CONTRACTS.usdc.toLowerCase() ? 'USDC' : 'EURC';
}

/// Nut hanh dong cho 1 position: goi thang contract (claimReward / withdraw)
/// va tu hien trang thai Pending -> Success/Error ngay tren nut, khong can modal rieng.
function PositionActionButton({
  positionId,
  action,
  label,
  disabled,
  disabledReason,
  onWithdrawBlocked,
  onDone,
}: {
  positionId: bigint;
  action: 'claimReward' | 'withdraw' | 'emergencyWithdraw';
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  onWithdrawBlocked?: () => void | Promise<void>;
  onDone: () => void | Promise<void>;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const {
    writeContractAsync,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();
  const [fallbackHash, setFallbackHash] = useState<`0x${string}` | undefined>();
  const activeHash = hash ?? fallbackHash;
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: activeHash });
  const syncedHash = useRef<`0x${string}` | undefined>(undefined);
  const resetTimerRef = useRef<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCheckingRewards, setIsCheckingRewards] = useState(false);
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDustForfeit, setConfirmDustForfeit] = useState(false);
  const [confirmEmergencyWithdraw, setConfirmEmergencyWithdraw] = useState(false);
  // `writeError` remains populated after the injected-provider fallback has
  // submitted successfully, so do not let that connector-only error mask the
  // receipt state of the real transaction.
  const isConnectorFallbackError = Boolean(
    fallbackHash && writeError?.message.includes('connector.getChainId is not a function'),
  );
  const error = actionError ?? (isConnectorFallbackError ? null : writeError) ?? receiptError;

  const handleClick = async () => {
    // Do not rely on the native disabled attribute alone. Reward data can
    // refresh between pointer-down and click, so keep the transaction handler
    // closed whenever the action is not currently allowed.
    if (disabled || isPending || isConfirming || isSyncing || isCheckingRewards) return;

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setPreflightMessage(null);
    setActionError(null);

    if (action === 'emergencyWithdraw' && !confirmEmergencyWithdraw) {
      setConfirmEmergencyWithdraw(true);
      setPreflightMessage('Confirm early exit?');
      resetTimerRef.current = window.setTimeout(() => {
        setConfirmEmergencyWithdraw(false);
        setPreflightMessage(null);
        resetTimerRef.current = null;
      }, 5_000);
      return;
    }

    if (action === 'claimReward') {
      if (!REWARD_DISTRIBUTOR_ADDRESS || !address || !publicClient) return;
      try {
        const { request } = await publicClient.simulateContract({
          account: address,
          address: REWARD_DISTRIBUTOR_ADDRESS,
          abi: rewardDistributorAbi,
          functionName: 'claimReward',
          args: [positionId],
        });
        await writeContractAsync(request);
      } catch (claimError) {
        // Some injected wallets expose a valid EIP-1193 provider but an
        // incomplete wagmi connector (missing getChainId). Claiming remains
        // safe through the provider because the same calldata was simulated
        // above; this fallback only handles that connector compatibility bug.
        const message = claimError instanceof Error ? claimError.message : '';
        const provider = (window as Window & {
          ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
        }).ethereum;

        if (message.includes('connector.getChainId is not a function') && provider) {
          try {
            const data = encodeFunctionData({
              abi: rewardDistributorAbi,
              functionName: 'claimReward',
              args: [positionId],
            });
            const transactionHash = await provider.request({
              method: 'eth_sendTransaction',
              params: [{ from: address, to: REWARD_DISTRIBUTOR_ADDRESS, data }],
            });
            if (typeof transactionHash !== 'string' || !transactionHash.startsWith('0x')) {
              throw new Error('Wallet did not return a transaction hash.');
            }
            setFallbackHash(transactionHash as `0x${string}`);
            return;
          } catch (fallbackError) {
            setActionError(fallbackError instanceof BaseError ? fallbackError.shortMessage : fallbackError instanceof Error ? fallbackError.message : 'Wallet could not submit the claim.');
            return;
          }
        }
        setActionError(claimError instanceof BaseError ? claimError.shortMessage : claimError instanceof Error ? claimError.message : 'Claim could not be prepared.');
      }
      return;
    }

    if (action === 'withdraw' && REWARD_DISTRIBUTOR_ADDRESS) {
      if (!publicClient) {
        setPreflightMessage('Check failed');
        resetTimerRef.current = window.setTimeout(() => {
          setPreflightMessage(null);
          resetTimerRef.current = null;
        }, 3_000);
        return;
      }

      setIsCheckingRewards(true);
      try {
        const pendingReward = await publicClient.readContract({
          address: REWARD_DISTRIBUTOR_ADDRESS,
          abi: rewardDistributorAbi,
          functionName: 'pendingReward',
          args: [positionId],
        });

        if (pendingReward >= MIN_CLAIMABLE_REWARD) {
          setPreflightMessage('Reward pending');
          setConfirmDustForfeit(false);
          await onWithdrawBlocked?.();
          resetTimerRef.current = window.setTimeout(() => {
            setPreflightMessage(null);
            resetTimerRef.current = null;
          }, 3_000);
          return;
        }

        if (pendingReward > 0n && !confirmDustForfeit) {
          setConfirmDustForfeit(true);
          setPreflightMessage('Forfeit dust?');
          resetTimerRef.current = window.setTimeout(() => {
            setConfirmDustForfeit(false);
            setPreflightMessage(null);
            resetTimerRef.current = null;
          }, 5_000);
          return;
        }
      } catch {
        // Fail closed: do not withdraw while the latest reward status is unknown.
        setPreflightMessage('Reward check failed');
        resetTimerRef.current = window.setTimeout(() => {
          setPreflightMessage(null);
          resetTimerRef.current = null;
        }, 3_000);
        return;
      } finally {
        setIsCheckingRewards(false);
      }
    }

    try {
      if (!publicClient || !address) throw new Error('Wallet client is unavailable.');
      const { request } = await publicClient.simulateContract({
        account: address,
        address: CONTRACTS.stakingVault,
        abi: stakingVaultAbi,
        functionName: action,
        args: [positionId],
      });
      await writeContractAsync(request);
      setConfirmDustForfeit(false);
      setConfirmEmergencyWithdraw(false);
    } catch (withdrawError) {
      const message = withdrawError instanceof Error ? withdrawError.message : '';
      const provider = (window as Window & {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }).ethereum;
      if (message.includes('connector.getChainId is not a function') && provider && address) {
        try {
          const data = encodeFunctionData({ abi: stakingVaultAbi, functionName: action, args: [positionId] });
          const transactionHash = await provider.request({
            method: 'eth_sendTransaction',
            params: [{ from: address, to: CONTRACTS.stakingVault, data }],
          });
          if (typeof transactionHash !== 'string' || !transactionHash.startsWith('0x')) {
            throw new Error('Wallet did not return a transaction hash.');
          }
          setFallbackHash(transactionHash as `0x${string}`);
          setConfirmEmergencyWithdraw(false);
          return;
        } catch (fallbackError) {
          setActionError(fallbackError instanceof BaseError ? fallbackError.shortMessage : fallbackError instanceof Error ? fallbackError.message : 'Wallet could not submit the withdrawal.');
          return;
        }
      }
      setActionError(withdrawError instanceof BaseError ? withdrawError.shortMessage : withdrawError instanceof Error ? withdrawError.message : 'Withdrawal could not be prepared.');
    }
  };

  useEffect(() => {
    if (!isSuccess || !activeHash || syncedHash.current === activeHash) return;
    syncedHash.current = activeHash;
    setIsSyncing(true);

    void Promise.resolve(onDone())
      .catch(() => undefined)
      .finally(() => {
        setIsSyncing(false);
        resetTimerRef.current = window.setTimeout(() => {
          reset();
          setFallbackHash(undefined);
          syncedHash.current = undefined;
          resetTimerRef.current = null;
        }, 1_200);
      });
  }, [activeHash, isSuccess, onDone, reset]);

  useEffect(() => {
    if (!error) return;

    resetTimerRef.current = window.setTimeout(() => {
      reset();
      setFallbackHash(undefined);
      setActionError(null);
      resetTimerRef.current = null;
    }, 3_000);
  }, [error, reset]);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  let text = label;
  if (error) text = 'Try again';
  else if (preflightMessage) text = preflightMessage;
  else if (isCheckingRewards) text = 'Checking…';
  else if (isPending) text = 'Confirm…';
  else if (isConfirming) text = 'Processing…';
  else if (isSyncing) text = 'Updating…';
  else if (isSuccess) text = action === 'claimReward' ? 'Claimed ✓' : 'Done ✓';

  return (
    <button
      className="row-action-btn"
      onClick={() => void handleClick()}
      disabled={disabled || isCheckingRewards || isPending || isConfirming || isSyncing}
      title={
        error
          ? typeof error === 'string' ? error : error.message
          : preflightMessage
            ? preflightMessage === 'Forfeit dust?'
              ? 'This position has less than 0.01 reward. Click again within 5 seconds to withdraw and forfeit that dust reward.'
              : 'Claim the accrued reward before withdrawing this position.'
            : disabled
              ? disabledReason
              : undefined
      }
    >
      {text}
    </button>
  );
}

export function StakePositionRow({
  position,
  reward,
  rewardsLoading,
  onClaimDone,
  onDone,
}: {
  position: StakePosition;
  reward: PositionRewardState;
  rewardsLoading: boolean;
  onClaimDone: () => void | Promise<void>;
  onDone: () => void | Promise<void>;
}) {
  const symbol = tokenSymbol(position.asset);
  const amount = Number(formatUnits(position.principal, 6));
  const isLocked = position.unlockTime > 0n && BigInt(Math.floor(Date.now() / 1000)) < position.unlockTime;
  const rewardsInactive = !reward.isActive && reward.amount === 0n;
  const canClaimReward = reward.amount >= MIN_CLAIMABLE_REWARD;
  // Tiny dust remains visible as accruing, but does not hold a Flexible
  // withdrawal hostage while the primary Claim button is intentionally muted.
  const mustClaimBeforeWithdraw = canClaimReward;
  const rewardDisplay = formatRewardDisplay(
    reward.amount,
    symbol,
    reward.annualRateBps > 0n,
  );
  const unlockDate = position.unlockTime > 0n
    ? new Date(Number(position.unlockTime) * 1000)
    : null;
  const shortUnlockDate = unlockDate
    ? new Intl.DateTimeFormat('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: '2-digit',
      }).format(unlockDate)
    : '';
  const fullUnlockDate = unlockDate
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(unlockDate)
    : '';

  return (
    <tr>
      <td>
        <span className="asset-with-icon">
          <TokenIcon symbol={symbol} size={22} />
          {symbol}
        </span>
      </td>
      <td>{TIER_LABELS[position.tier] ?? '—'}</td>
      <td><span className="protocol-badge protocol-badge--legacy">Legacy</span></td>
      <td className="numeric-cell">{amount.toFixed(2)}</td>
      <td className="numeric-cell">
        {rewardsLoading ? (
          <span className="reward-status">Syncing…</span>
        ) : rewardsInactive ? (
          <span className="reward-status reward-status--inactive">Rewards inactive</span>
        ) : (
          <span className="reward-amount">
            <span
              title={rewardDisplay.exactLabel}
              aria-label={rewardDisplay.exactLabel}
              tabIndex={reward.amount > 0n ? 0 : undefined}
            >
              {rewardDisplay.label}
            </span>
            {reward.annualRateBps > 0n && (
              <small>{(Number(reward.annualRateBps) / 100).toFixed(2)}% reward APR</small>
            )}
          </span>
        )}
      </td>
      <td>
        {isLocked ? (
          <span
            className="position-lock position-lock--locked"
            title={`Locked until ${fullUnlockDate}`}
          >
            Until {shortUnlockDate}
          </span>
        ) : (
          <span className="position-lock">Unlocked</span>
        )}
      </td>
      <td className="position-actions-cell">
        <div className="position-actions">
          {canClaimReward && REWARD_DISTRIBUTOR_ADDRESS ? (
            <PositionActionButton
              positionId={position.id}
              action="claimReward"
              label="Claim"
              onDone={onClaimDone}
            />
          ) : (
            <span
              className="row-action-btn row-action-btn--disabled"
              role="button"
              aria-disabled="true"
              title={
                !REWARD_DISTRIBUTOR_ADDRESS
                  ? 'Rewards are not configured for this deployment.'
                  : `Rewards become claimable at 0.01 ${symbol}.`
              }
            >
              Claim
            </span>
          )}
          <PositionActionButton
            positionId={position.id}
            action={isLocked ? 'emergencyWithdraw' : 'withdraw'}
            label={isLocked ? 'Emergency withdraw' : 'Withdraw'}
            disabled={!isLocked && mustClaimBeforeWithdraw}
            disabledReason={
              !isLocked && mustClaimBeforeWithdraw
                ? 'Claim the accrued reward first. Withdraw becomes available after the claim is confirmed.'
                : isLocked
                  ? 'Returns principal now. Unclaimed rewards may be forfeited under the early-withdrawal penalty.'
                  : undefined
            }
            onWithdrawBlocked={onClaimDone}
            onDone={onDone}
          />
        </div>
      </td>
    </tr>
  );
}

export function V2StakePositionRow({ position, reward, onDone }: {
  position: V2StakePosition;
  reward: V2PositionRewardState;
  onDone: () => void | Promise<void>;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const symbol = tokenSymbol(position.asset);
  const isLocked = position.unlockTime > BigInt(Math.floor(Date.now() / 1000));
  const canClaim = reward.amount >= MIN_CLAIMABLE_REWARD;
  const [error, setError] = useState<string | null>(null);

  const execute = async (action: 'claimReward' | 'withdraw' | 'emergencyWithdraw') => {
    if (!address || !publicClient || isPending || isConfirming) return;
    try {
      const { request } = await publicClient.simulateContract({
        account: address,
        address: V2_CONTRACTS.stakingVault,
        abi: stakingVaultV2Abi,
        functionName: action,
        args: [position.id],
      });
      await writeContractAsync(request);
    } catch (caught) {
      setError(caught instanceof BaseError ? caught.shortMessage : 'Transaction could not be prepared.');
    }
  };

  useEffect(() => {
    if (isSuccess) void onDone();
  }, [isSuccess, onDone]);

  return <tr>
    <td><span className="asset-with-icon"><TokenIcon symbol={symbol} size={22} />{symbol}</span></td>
    <td>{TIER_LABELS[position.tier] ?? '—'}</td>
    <td><span className="protocol-badge protocol-badge--v2">V2</span></td>
    <td className="numeric-cell">{Number(formatUnits(position.principal, 6)).toFixed(2)}</td>
    <td className="numeric-cell">{formatRewardDisplay(reward.amount, symbol, false).label}</td>
    <td><span className={`position-lock${isLocked ? ' position-lock--locked' : ''}`}>{isLocked ? 'Locked' : 'Unlocked'}</span></td>
    <td className="position-actions-cell"><div className="position-actions">
      <button className="row-action-btn" disabled={!canClaim || isPending || isConfirming} title={!canClaim ? `Rewards become claimable at 0.01 ${symbol}.` : undefined} onClick={() => void execute('claimReward')}>{isPending || isConfirming ? 'Processing…' : 'Claim'}</button>
      <button className="row-action-btn" disabled={isPending || isConfirming} title={error ?? (isLocked ? 'Early withdrawal returns principal but applies the reward penalty.' : undefined)} onClick={() => void execute(isLocked ? 'emergencyWithdraw' : 'withdraw')}>{isLocked ? 'Early withdraw' : 'Withdraw'}</button>
    </div></td>
  </tr>;
}

export function Dashboard() {
  const { address } = useAccount();
  const {
    positions,
    isLoading: positionsLoading,
    refetch: refetchPositions,
  } = usePositions();
  const {
    getReward,
    isLoading: rewardsLoading,
    refreshAfterClaim,
  } = usePositionRewards(positions);
  const [stakeDrawerOpen, setStakeDrawerOpen] = useState(false);
  const [borrowDrawerOpen, setBorrowDrawerOpen] = useState(false);
  const [selectedRepayAsset, setSelectedRepayAsset] = useState<{ asset: 'USDC' | 'EURC'; deployment: 'v1' | 'v2' } | null>(null);
  const [optimisticStakedFloor, setOptimisticStakedFloor] = useState<number | null>(null);
  const {
    positions: v2Positions,
    refetch: refetchV2Positions,
  } = useV2Positions();
  const {
    getReward: getV2Reward,
    refetchRewards: refetchV2Rewards,
  } = useV2PositionRewards(v2Positions);
  const v2LoansState = useV2Loans(!stakeDrawerOpen && !borrowDrawerOpen);
  const refreshProtocolData = useRefreshProtocolData();
  const refreshRetryRef = useRef<number | null>(null);
  const readyAddressRef = useRef<`0x${string}` | undefined>(undefined);

  const anyDrawerOpen = stakeDrawerOpen || borrowDrawerOpen || selectedRepayAsset !== null;

  const {
    data,
    isLoading,
    refetch: refetchDashboardReads,
  } = useReadContracts({
    contracts: address
      ? [
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'getHealthFactor', args: [address] },
          { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'viewPrice', args: [] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'getTotalStakedByUser', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'getTotalStakedByUser', args: [address, CONTRACTS.eurc] },
        ]
      : [],
    // Keep portfolio totals reasonably fresh while the dashboard is open.
    // Transaction callbacks still force an immediate refetch.
    query: { enabled: !!address, refetchInterval: anyDrawerOpen ? false : 10_000 },
  });

  const refreshDashboard = useCallback(async () => {
    await Promise.all([
      refreshProtocolData(),
      refetchPositions(),
      refetchDashboardReads(),
      refetchV2Positions(),
      refetchV2Rewards(),
      v2LoansState.refetch(),
    ]);

    // Arc Testnet RPC nodes can briefly trail the receipt block. Verify once
    // more in the background so the UI settles without a manual page reload.
    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }

    refreshRetryRef.current = window.setTimeout(() => {
      void Promise.all([
        refetchPositions(),
        refetchDashboardReads(),
        refetchV2Positions(),
        v2LoansState.refetch(),
      ]).then(() => {
        // Arc RPC nodes can lag the receipt block by more than one response.
        // A second short retry avoids requiring a manual page reload without
        // making the dashboard poll aggressively all the time.
        refreshRetryRef.current = window.setTimeout(() => {
          void Promise.all([refetchPositions(), refetchDashboardReads()]);
          refreshRetryRef.current = null;
        }, 1_500);
      });
    }, 700);
  }, [
    refreshProtocolData,
    refetchDashboardReads,
    refetchPositions,
    refetchV2Positions,
    refetchV2Rewards,
    v2LoansState,
  ]);

  // Keep a temporary floor sourced from the confirmed transaction itself.
  // Arc RPC reads can trail the receipt block briefly, so rendering only the
  // refetched value makes totals jump backward before they catch up.
  const liveOraclePrice = data?.[5]?.result as [bigint, bigint] | undefined;
  const liveEurcUsdPrice = liveOraclePrice && liveOraclePrice[0] > 0n
    ? Number(formatUnits(liveOraclePrice[0], 18))
    : 0;
  const liveStakedUsdc = Number(formatUnits((data?.[6]?.result as bigint) ?? 0n, 6));
  const liveStakedEurc = Number(formatUnits((data?.[7]?.result as bigint) ?? 0n, 6));
  const liveTotalStakedUsd = liveStakedUsdc + liveStakedEurc * liveEurcUsdPrice;

  useEffect(() => {
    if (optimisticStakedFloor === null || !data) return;
    if (liveTotalStakedUsd + 0.000001 >= optimisticStakedFloor) {
      setOptimisticStakedFloor(null);
    }
  }, [data, liveTotalStakedUsd, optimisticStakedFloor]);

  const handleStakeConfirmed = useCallback((stake: { asset: 'USDC' | 'EURC'; amount: bigint }) => {
    const tokenAmount = Number(formatUnits(stake.amount, 6));
    const usdDelta = stake.asset === 'EURC' ? tokenAmount * liveEurcUsdPrice : tokenAmount;
    setOptimisticStakedFloor((currentFloor) => (
      Math.max(currentFloor ?? liveTotalStakedUsd, liveTotalStakedUsd) + usdDelta
    ));
    return refreshDashboard();
  }, [liveEurcUsdPrice, liveTotalStakedUsd, refreshDashboard]);

  const handlePortfolioMutation = useCallback(() => {
    setOptimisticStakedFloor(null);
    return refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => () => {
    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }
  }, []);

  if (!address) return null;

  const hasRenderedPortfolio = readyAddressRef.current === address;
  if (!data || (!hasRenderedPortfolio && (isLoading || positionsLoading))) {
    return (
      <div className="dashboard">
        <h2>Dashboard</h2>
        <p className="text-secondary">Loading your portfolio...</p>
      </div>
    );
  }

  // Once a wallet has a complete snapshot, background reads for a newly
  // created position must never replace the whole dashboard with a loader.
  readyAddressRef.current = address;

  const collateralUsdc = Number(formatUnits((data[0]?.result as bigint) ?? 0n, 6));
  const collateralEurc = Number(formatUnits((data[1]?.result as bigint) ?? 0n, 6));

  const usdcLoan = data[2]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const eurcLoan = data[3]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const usdcDebt = usdcLoan ? Number(formatUnits(usdcLoan[0] + usdcLoan[2], 6)) : 0;
  const eurcDebt = eurcLoan ? Number(formatUnits(eurcLoan[2] + eurcLoan[0], 6)) : 0;

  const hfRaw = data[4]?.result as bigint | undefined;
  const hf = hfRaw !== undefined ? Number(formatUnits(hfRaw, 18)) : 0;
  const hasLoans = hf > 0 && hf < MAX_HF_THRESHOLD;
  const hasLiquidationRisk = hasLoans && hf < 1.2;

  const oraclePrice = data[5]?.result as [bigint, bigint] | undefined;
  const eurcUsdPrice = oraclePrice && oraclePrice[0] > 0n
    ? Number(formatUnits(oraclePrice[0], 18))
    : 0;
  const oracleAvailable = eurcUsdPrice > 0;

  const stakedUsdc = Number(formatUnits((data[6]?.result as bigint) ?? 0n, 6));
  const stakedEurc = Number(formatUnits((data[7]?.result as bigint) ?? 0n, 6));

  const v2StakedUsdc = Number(formatUnits(
    v2Positions.filter((position) => tokenSymbol(position.asset) === 'USDC').reduce((total, position) => total + position.principal, 0n),
    6,
  ));
  const v2StakedEurc = Number(formatUnits(
    v2Positions.filter((position) => tokenSymbol(position.asset) === 'EURC').reduce((total, position) => total + position.principal, 0n),
    6,
  ));
  const v2EurcUsdPrice = TESTNET_ORACLE.initialPrice;
  const v2TotalStakedUsd = v2StakedUsdc + v2StakedEurc * v2EurcUsdPrice;
  const v2DebtUsd = v2LoansState.loans.reduce((total, loan) => total + Number(formatUnits(loan.debt, 6)) * (loan.asset === 'EURC' ? v2EurcUsdPrice : 1), 0);
  const v2CollateralUsd = v2TotalStakedUsd;
  const v2Hf = v2DebtUsd > 0 && v2LoansState.oracleHealthy
    ? (v2CollateralUsd * Number(v2LoansState.liquidationThresholdBps)) / (v2DebtUsd * 10_000)
    : 0;
  const v2HasLoans = v2DebtUsd > 0;

  const totalStakedUsd = Math.max(
    stakedUsdc + stakedEurc * eurcUsdPrice + v2TotalStakedUsd,
    optimisticStakedFloor ?? 0,
  );
  const totalCollateralUsd = collateralUsdc + collateralEurc * eurcUsdPrice;
  const totalBorrowedUsd = usdcDebt + eurcDebt * eurcUsdPrice + v2DebtUsd;
  const netWorthUsd = totalStakedUsd + totalCollateralUsd - totalBorrowedUsd;

  const borrowRows = [
    { symbol: 'USDC' as const, amount: usdcDebt, interest: usdcLoan ? Number(formatUnits(usdcLoan[2], 6)) : 0 },
    { symbol: 'EURC' as const, amount: eurcDebt, interest: eurcLoan ? Number(formatUnits(eurcLoan[2], 6)) : 0 },
  ].filter((row) => row.amount > 0).map((row) => ({ ...row, deployment: 'v1' as const }));
  const allBorrowRows = [
    ...borrowRows,
    ...v2LoansState.loans.map((loan) => ({
      symbol: loan.asset,
      amount: Number(formatUnits(loan.debt, 6)),
      interest: Number(formatUnits(loan.storedInterest + loan.pendingInterest, 6)),
      deployment: 'v2' as const,
    })),
  ];

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      <p className="text-secondary">Welcome back. Here's your portfolio overview.</p>

      <div className={`oracle-disclosure ${oracleAvailable ? '' : 'oracle-disclosure--error'}`}>
        <span className="oracle-disclosure__badge">Testnet FX</span>
        <strong>
          {oracleAvailable ? `1 EURC = $${eurcUsdPrice.toFixed(4)}` : `${TESTNET_ORACLE.pair} unavailable`}
        </strong>
        <span>{TESTNET_ORACLE.label} · not a production oracle</span>
      </div>

      {!v2LoansState.oracleHealthy && (
        <div className="oracle-disclosure oracle-disclosure--error" role="status">
          <span className="oracle-disclosure__badge">V2 Oracle</span>
          <strong>Price refresh needed</strong>
          <span>V2 borrowing and risk previews are temporarily unavailable. Try again shortly.</span>
        </div>
      )}

      {hasLiquidationRisk && (
        <div className="risk-alert" role="alert">
          <span className="risk-alert__icon">!</span>
          <div>
            <strong>Your position is at risk of liquidation</strong>
            <span>
              Health Factor: {hf.toFixed(2)}. Repay debt or add collateral to move away from the 1.00 liquidation threshold.
            </span>
          </div>
        </div>
      )}

      <div className={hasLoans && v2HasLoans ? 'hf-gauge-stack' : undefined}>
        {hasLoans ? <HealthFactorGauge label="Legacy Health Factor" hf={hf} hasLoans /> : null}
        {v2HasLoans ? (
          <HealthFactorGauge
            label="V2 Health Factor"
            hf={v2Hf}
            hasLoans
            unavailable={!v2LoansState.oracleHealthy}
          />
        ) : null}
        {!hasLoans && !v2HasLoans ? <HealthFactorGauge hf={0} hasLoans={false} /> : null}
      </div>

      <div className="dashboard-quick-actions">
        <button className="cta-button" onClick={() => setStakeDrawerOpen(true)}>
          + New Stake
        </button>
        <button className="cta-button" onClick={() => setBorrowDrawerOpen(true)} style={{ background: 'transparent', border: '1px solid var(--color-accent)', color: 'var(--color-accent)' }}>
          Borrow
        </button>
      </div>

      <div className="dashboard-banner">
        <div className="banner-card banner-card--primary glass-panel">
          <span className="banner-card__label">Net Worth</span>
          <span className="banner-card__value">$<CountUp value={netWorthUsd} duration={1.2} /></span>
        </div>
        <div className="banner-card glass-panel">
          <span className="banner-card__label">Total Staked</span>
          <span className="banner-card__value">$<CountUp value={totalStakedUsd} duration={1.2} /></span>
        </div>
        <div className="banner-card glass-panel">
          <span className="banner-card__label">Total Borrowed</span>
          <span className="banner-card__value">$<CountUp value={totalBorrowedUsd} duration={1.2} /></span>
        </div>
        <div className="banner-card glass-panel">
          <span className="banner-card__label">Active Positions</span>
          <span className="banner-card__value">{positions.length + v2Positions.length}</span>
        </div>
      </div>

      <div className="positions-grid">
        <div className="positions-panel glass-panel">
          <h3>Your Staking Positions</h3>
          {positions.length + v2Positions.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">No Stakes Yet</span>
              <span className="empty-state__subtitle">Stake assets from your wallet to open a position</span>
            </div>
          ) : (
            <div className="positions-table-scroll">
              <table className="positions-table positions-table--stakes">
                <colgroup>
                  <col className="positions-col--asset" />
                  <col className="positions-col--vault" />
                  <col className="positions-col--protocol" />
                  <col className="positions-col--amount" />
                  <col className="positions-col--reward" />
                  <col className="positions-col--lock" />
                  <col className="positions-col--actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Vault</th>
                    <th>Protocol</th>
                    <th className="numeric-cell">Amount</th>
                    <th className="numeric-cell">
                      <span className="table-header-label">
                        Reward
                        <InfoTip text="Claimable rewards come from a separately funded testnet program, are paid in the staked token, and refresh about every 5 seconds." />
                      </span>
                    </th>
                    <th>
                      <span className="table-header-label">
                        Lock
                        <InfoTip text="Flexible positions are unlocked immediately. Growth and Diamond positions unlock after their fixed term." />
                      </span>
                    </th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <StakePositionRow
                      key={p.id.toString()}
                      position={p}
                      reward={getReward(p.id)}
                      rewardsLoading={rewardsLoading}
                      onClaimDone={refreshAfterClaim}
                      onDone={handlePortfolioMutation}
                    />
                  ))}
                  {v2Positions.map((p) => (
                    <V2StakePositionRow
                      key={`v2-${p.id}`}
                      position={p}
                      reward={getV2Reward(p)}
                      onDone={handlePortfolioMutation}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="positions-panel glass-panel">
          <h3>Your Borrowed Positions</h3>
          {allBorrowRows.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">Nothing Borrowed Yet</span>
              <span className="empty-state__subtitle">Borrow stablecoins against your active staking positions</span>
            </div>
          ) : (
            <div className="positions-table-scroll">
              <table className="positions-table positions-table--borrows">
                <colgroup>
                  <col className="positions-col--borrow-asset" />
                  <col className="positions-col--protocol" />
                  <col className="positions-col--borrow-amount" />
                  <col className="positions-col--borrow-interest" />
                  <col className="positions-col--borrow-status" />
                  <col className="positions-col--borrow-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Protocol</th>
                    <th className="numeric-cell">Debt</th>
                    <th className="numeric-cell">Interest</th>
                    <th>Status</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {allBorrowRows.map((row) => (
                    <tr key={`${row.deployment}-${row.symbol}`}>
                      <td>
                        <span className="asset-with-icon">
                          <TokenIcon symbol={row.symbol} size={22} />
                          {row.symbol}
                        </span>
                      </td>
                      <td><span className={`protocol-badge protocol-badge--${row.deployment === 'v1' ? 'legacy' : 'v2'}`}>{row.deployment === 'v1' ? 'Legacy' : 'V2'}</span></td>
                      <td className="numeric-cell">{row.amount.toFixed(2)}</td>
                      <td className="numeric-cell">{row.interest.toFixed(4)}</td>
                      <td><span className="status-pill status-pill--active">Active</span></td>
                      <td className="position-actions-cell">
                        <button
                          className="row-action-btn"
                          type="button"
                          aria-label={`Repay ${row.symbol}`}
                          onClick={() => setSelectedRepayAsset({ asset: row.symbol, deployment: row.deployment })}
                        >
                          Repay
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <StakeDrawer
        open={stakeDrawerOpen}
        onClose={() => setStakeDrawerOpen(false)}
        onTransactionConfirmed={handleStakeConfirmed}
      />

      <BorrowDrawer
        open={borrowDrawerOpen}
        onClose={() => setBorrowDrawerOpen(false)}
        onTransactionConfirmed={refreshDashboard}
      />

      <RepayDrawer
        open={selectedRepayAsset?.deployment === 'v1'}
        asset={selectedRepayAsset?.asset ?? 'USDC'}
        onClose={() => setSelectedRepayAsset(null)}
        onTransactionConfirmed={refreshDashboard}
      />
      <V2RepayDrawer
        open={selectedRepayAsset?.deployment === 'v2'}
        asset={selectedRepayAsset?.asset ?? 'USDC'}
        onClose={() => setSelectedRepayAsset(null)}
        onTransactionConfirmed={refreshDashboard}
      />
    </div>
  );
}
