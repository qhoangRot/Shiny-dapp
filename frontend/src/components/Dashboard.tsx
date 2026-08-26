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
  rewardDistributorAbi,
  stakingVaultAbi,
  stakingVaultV2Abi,
  oracleAdapterV2Abi,
} from '../config/contracts';
import { CountUp } from './CountUp';
import { TokenIcon } from './TokenIcon';
import { HealthFactorGauge } from './HealthFactorGauge';
import { InfoTip } from './InfoTip';
import { type StakePosition } from '../hooks/usePositions';
import { useV2Positions, type V2StakePosition } from '../hooks/useV2Positions';
import { useV2PositionRewards, type V2PositionRewardState } from '../hooks/useV2PositionRewards';
import { useV2Loans } from '../hooks/useV2Loans';
import { type PositionRewardState } from '../hooks/usePositionRewards';
import { formatRewardDisplay, MIN_CLAIMABLE_REWARD } from '../lib/rewards';
import { StakeDrawer } from './StakeDrawer';
import { BorrowDrawer } from './BorrowDrawer';
import { V2RepayDrawer } from './V2RepayDrawer';

const TIER_LABELS = ['Flexible', 'Growth', 'Diamond'];
const PENALTY_FREE_PERIOD = 90 * 24 * 60 * 60;
const PENALTY_FULL_PERIOD = 365 * 24 * 60 * 60;

type OptimisticStake = {
  asset: 'USDC' | 'EURC';
  amount: bigint;
};

function tokenSymbol(asset: string): 'USDC' | 'EURC' {
  return asset.toLowerCase() === CONTRACTS.usdc.toLowerCase() ? 'USDC' : 'EURC';
}

function withdrawalPenaltyBps(stakedAt: bigint) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - Number(stakedAt));
  if (elapsed <= PENALTY_FREE_PERIOD) return 10_000;
  if (elapsed >= PENALTY_FULL_PERIOD) return 0;
  return Math.round(((PENALTY_FULL_PERIOD - elapsed) * 10_000) / (PENALTY_FULL_PERIOD - PENALTY_FREE_PERIOD));
}

function CapitalAccountPanel({
  positions,
  getReward,
  loans,
  oracleHealthy,
  usdcPrice,
  eurcPrice,
  loading,
  error,
  onRetry,
  optimisticStake,
}: {
  positions: V2StakePosition[];
  getReward: (position: V2StakePosition) => V2PositionRewardState;
  loans: ReturnType<typeof useV2Loans>['loans'];
  oracleHealthy: boolean;
  usdcPrice: number;
  eurcPrice: number;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  optimisticStake: OptimisticStake | null;
}) {
  if (loading) return <div className="capital-account glass-panel"><div className="capital-account__skeleton" /><div className="capital-account__skeleton" /></div>;
  if (error) return <div className="capital-account glass-panel capital-account--error"><strong>Capital account unavailable</strong><button type="button" onClick={onRetry}>Retry</button></div>;
  if (positions.length === 0 && !optimisticStake) return null;
  const assets = (['USDC', 'EURC'] as const).map((symbol) => {
    const price = symbol === 'USDC' ? usdcPrice : eurcPrice;
    const rows = positions.filter((p) => tokenSymbol(p.asset) === symbol);
    const optimisticAmount = optimisticStake?.asset === symbol ? optimisticStake.amount : 0n;
    const staked = rows.reduce((sum, p) => sum + p.principal, 0n) + optimisticAmount;
    const rewards = rows.reduce((sum, p) => sum + getReward(p).amount, 0n);
    const debt = loans.filter((l) => l.asset === symbol).reduce((sum, l) => sum + l.debt, 0n);
    const stakedValue = Number(formatUnits(staked, 6));
    const rewardValue = Number(formatUnits(rewards, 6));
    const debtValue = Number(formatUnits(debt, 6));
    return { symbol, price, stakedValue, rewardValue, debtValue, net: stakedValue + rewardValue - debtValue, collateralUsd: stakedValue * price };
  });
  const portfolioCollateralUsd = assets.reduce((sum, asset) => sum + asset.collateralUsd, 0);
  return <section className="capital-account glass-panel">
    <div className="capital-account__header"><div><span className="card-kicker">CAPITAL ACCOUNT</span><h3>Capital that stays useful</h3></div><span className="capital-account__scope">Your active positions</span></div>
    <div className="capital-account__assets">{assets.map((asset) => <div className="capital-account__asset" key={asset.symbol}>
      <div className="capital-account__asset-title"><TokenIcon symbol={asset.symbol} size={24} /><strong>{asset.symbol}</strong></div>
      <div className="capital-account__metrics"><span>Staked<strong>{asset.stakedValue.toFixed(2)} {asset.symbol}</strong></span><span>Pending reward<strong>{asset.rewardValue.toFixed(4)} {asset.symbol}</strong></span><span>Debt<strong>{asset.debtValue.toFixed(4)} {asset.symbol}</strong></span><span>Net position<strong>{asset.net.toFixed(2)} {asset.symbol}</strong></span></div>
    </div>)}</div>
    <div className="credit-lines"><div className="capital-account__header"><span className="card-kicker">CREDIT LINE</span><span className="capital-account__scope">Portfolio collateral · 75% max LTV</span></div>{!oracleHealthy ? <div className="credit-line__stale">Price refresh needed. Credit lines and risk previews are temporarily unavailable.</div> : <div className="credit-lines__grid">{assets.map((asset) => { const limit = portfolioCollateralUsd * 0.75 / asset.price; const used = asset.debtValue; const available = Math.max(limit - used, 0); const utilization = limit > 0 ? Math.min(used / limit, 1) : 0; const utilizationTone = utilization > 0.75 ? 'credit-line__bar--high' : utilization > 0.5 ? 'credit-line__bar--medium' : 'credit-line__bar--low'; return <div className="credit-line" key={asset.symbol}><div className="credit-line__top"><strong>{asset.symbol} Credit Line</strong><span>{(utilization * 100).toFixed(0)}% used</span></div><div className={`credit-line__bar ${utilizationTone}`}><i style={{ width: `${utilization * 100}%` }} /></div><div className="credit-line__values"><span>Limit<strong>{limit.toFixed(2)} {asset.symbol}</strong></span><span>Used<strong>{used.toFixed(4)} {asset.symbol}</strong></span><span>Available<strong>{available.toFixed(2)} {asset.symbol}</strong></span></div></div>})}</div>}</div>
  </section>;
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
  const [stakeDrawerOpen, setStakeDrawerOpen] = useState(false);
  const [borrowDrawerOpen, setBorrowDrawerOpen] = useState(false);
  const [selectedRepayAsset, setSelectedRepayAsset] = useState<'USDC' | 'EURC' | null>(null);
  const [optimisticStakedFloor, setOptimisticStakedFloor] = useState<number | null>(null);
  const [optimisticStake, setOptimisticStake] = useState<OptimisticStake | null>(null);
  const {
    positions: v2Positions,
    isLoading: v2PositionsLoading,
    isError: v2PositionsError,
    refetch: refetchV2Positions,
  } = useV2Positions();
  const {
    getReward: getV2Reward,
    isError: v2RewardsError,
    refetchRewards: refetchV2Rewards,
  } = useV2PositionRewards(v2Positions);
  // Keep the risk read alive while a drawer is open. Disabling it made an
  // undefined read look like an unhealthy oracle, producing a false stale
  // warning behind the Stake/Borrow/Repay panels.
  const v2LoansState = useV2Loans();
  const v2OraclePrices = useReadContracts({
    contracts: address ? [
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'lastAcceptedPrice' as const, args: [CONTRACTS.usdc] as const },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'lastAcceptedPrice' as const, args: [CONTRACTS.eurc] as const },
    ] : [],
    query: { enabled: Boolean(address), refetchInterval: 30_000, staleTime: 10_000 },
  });
  const refreshRetryRef = useRef<number | null>(null);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([
      refetchV2Positions(),
      refetchV2Rewards(),
      v2LoansState.refetch(),
      v2OraclePrices.refetch(),
    ]);

    // Arc Testnet RPC nodes can briefly trail the receipt block. Verify once
    // more in the background so the UI settles without a manual page reload.
    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }

    refreshRetryRef.current = window.setTimeout(() => {
      void Promise.all([
        refetchV2Positions(),
        refetchV2Rewards(),
        v2LoansState.refetch(),
      ]).then(() => {
        // Arc RPC nodes can lag the receipt block by more than one response.
        // A second short retry avoids requiring a manual page reload without
        // making the dashboard poll aggressively all the time.
        refreshRetryRef.current = window.setTimeout(() => {
          void Promise.all([refetchV2Positions(), refetchV2Rewards(), v2LoansState.refetch()]);
          refreshRetryRef.current = null;
        }, 1_500);
      });
    }, 700);
  }, [
    refetchV2Positions,
    refetchV2Rewards,
    v2LoansState,
    v2OraclePrices,
  ]);

  const liveUsdcPrice = Number(formatUnits((v2OraclePrices.data?.[0]?.result as bigint | undefined) ?? 1_000000000000000000n, 18));
  const liveEurcUsdPrice = Number(formatUnits((v2OraclePrices.data?.[1]?.result as bigint | undefined) ?? 1_080000000000000000n, 18));
  const liveTotalStakedUsd = v2Positions.reduce((total, position) => {
    const amount = Number(formatUnits(position.principal, 6));
    return total + amount * (tokenSymbol(position.asset) === 'EURC' ? liveEurcUsdPrice : liveUsdcPrice);
  }, 0);

  useEffect(() => {
    if (optimisticStakedFloor === null) return;
    if (liveTotalStakedUsd + 0.000001 >= optimisticStakedFloor) {
      setOptimisticStakedFloor(null);
      setOptimisticStake(null);
    }
  }, [liveTotalStakedUsd, optimisticStakedFloor]);

  const handleStakeConfirmed = useCallback((stake: { asset: 'USDC' | 'EURC'; amount: bigint }) => {
    const tokenAmount = Number(formatUnits(stake.amount, 6));
    const usdDelta = stake.asset === 'EURC' ? tokenAmount * liveEurcUsdPrice : tokenAmount;
    setOptimisticStakedFloor((currentFloor) => (
      Math.max(currentFloor ?? liveTotalStakedUsd, liveTotalStakedUsd) + usdDelta
    ));
    setOptimisticStake({ asset: stake.asset, amount: stake.amount });
    return refreshDashboard();
  }, [liveEurcUsdPrice, liveTotalStakedUsd, refreshDashboard]);

  const handlePortfolioMutation = useCallback(() => {
    setOptimisticStakedFloor(null);
    setOptimisticStake(null);
    return refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => () => {
    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }
  }, []);

  if (!address) return null;

  if (v2PositionsLoading && v2Positions.length === 0) {
    return (
      <div className="dashboard">
        <h2>Dashboard</h2>
        <p className="text-secondary">Loading your portfolio...</p>
      </div>
    );
  }

  const v2StakedUsdc = Number(formatUnits(
    v2Positions.filter((position) => tokenSymbol(position.asset) === 'USDC').reduce((total, position) => total + position.principal, 0n),
    6,
  ));
  const v2StakedEurc = Number(formatUnits(
    v2Positions.filter((position) => tokenSymbol(position.asset) === 'EURC').reduce((total, position) => total + position.principal, 0n),
    6,
  ));
  const v2EurcUsdPrice = liveEurcUsdPrice;
  const v2TotalStakedUsd = v2StakedUsdc + v2StakedEurc * v2EurcUsdPrice;
  const v2DebtUsd = v2LoansState.loans.reduce((total, loan) => total + Number(formatUnits(loan.debt, 6)) * (loan.asset === 'EURC' ? v2EurcUsdPrice : 1), 0);
  const v2CollateralUsd = v2TotalStakedUsd;
  const v2Hf = v2DebtUsd > 0 && v2LoansState.oracleHealthy
    ? (v2CollateralUsd * Number(v2LoansState.liquidationThresholdBps)) / (v2DebtUsd * 10_000)
    : 0;
  const v2HasLoans = v2DebtUsd > 0;
  const v2UsdcPrice = Number(formatUnits((v2OraclePrices.data?.[0]?.result as bigint | undefined) ?? 1_000000000000000000n, 18));
  const v2EurcPrice = Number(formatUnits((v2OraclePrices.data?.[1]?.result as bigint | undefined) ?? 1_080000000000000000n, 18));
  const sortedV2Positions = [...v2Positions].sort((a, b) => withdrawalPenaltyBps(a.startTime) - withdrawalPenaltyBps(b.startTime));

  const totalStakedUsd = Math.max(v2TotalStakedUsd, optimisticStakedFloor ?? 0);
  const totalBorrowedUsd = v2DebtUsd;
  const netWorthUsd = totalStakedUsd - totalBorrowedUsd;
  const visibleOptimisticStake = optimisticStake
    && optimisticStakedFloor !== null
    && liveTotalStakedUsd + 0.000001 < optimisticStakedFloor
    ? optimisticStake
    : null;

  const allBorrowRows = v2LoansState.loans.map((loan) => ({
      symbol: loan.asset,
      amount: Number(formatUnits(loan.debt, 6)),
      interest: Number(formatUnits(loan.storedInterest + loan.pendingInterest, 6)),
    }));

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      <p className="text-secondary">Welcome back. Here's your portfolio overview.</p>

      <div className="oracle-disclosure">
        <span className="oracle-disclosure__badge">Testnet FX</span>
        <strong>
          {`1 EURC = $${v2EurcUsdPrice.toFixed(4)}`}
        </strong>
        <span>{TESTNET_ORACLE.label} · not a production oracle</span>
      </div>

      {!v2LoansState.oracleHealthy && (
        <div className="oracle-disclosure oracle-disclosure--error" role="status">
          <span className="oracle-disclosure__badge">Oracle</span>
          <strong>Price refresh needed</strong>
          <span>Borrowing and risk previews are temporarily unavailable. Try again shortly.</span>
        </div>
      )}

      {v2HasLoans && v2Hf < 1.2 && (
        <div className="risk-alert" role="alert">
          <span className="risk-alert__icon">!</span>
          <div>
            <strong>Your position is at risk of liquidation</strong>
            <span>
              Health Factor: {v2Hf.toFixed(2)}. Repay debt or add collateral to move away from the 1.00 liquidation threshold.
            </span>
          </div>
        </div>
      )}

      <div>
        {v2HasLoans ? (
          <HealthFactorGauge
            label="Health Factor"
            hf={v2Hf}
            hasLoans
            unavailable={!v2LoansState.oracleHealthy}
          />
        ) : null}
        {!v2HasLoans ? <HealthFactorGauge hf={0} hasLoans={false} /> : null}
      </div>

      <div className="dashboard-quick-actions">
        <button className="cta-button" onClick={() => setStakeDrawerOpen(true)}>
          + New Stake
        </button>
        <button className="cta-button" onClick={() => setBorrowDrawerOpen(true)} style={{ background: 'transparent', border: '1px solid var(--color-accent)', color: 'var(--color-accent)' }}>
          Borrow
        </button>
      </div>

      <CapitalAccountPanel
        positions={v2Positions}
        getReward={getV2Reward}
        loans={v2LoansState.loans}
        oracleHealthy={v2LoansState.oracleHealthy}
        usdcPrice={v2UsdcPrice}
        eurcPrice={v2EurcPrice}
        loading={v2PositionsLoading && v2Positions.length === 0}
        error={v2PositionsError || v2RewardsError || v2LoansState.isError || v2OraclePrices.isError}
        onRetry={() => { void Promise.all([refetchV2Positions(), refetchV2Rewards(), v2LoansState.refetch(), v2OraclePrices.refetch()]); }}
        optimisticStake={visibleOptimisticStake}
      />

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
          <span className="banner-card__value">{v2Positions.length}</span>
        </div>
      </div>

      <div className="positions-grid">
        <div className="positions-panel glass-panel">
          <h3>Your Staking Positions</h3>
          {v2Positions.length === 0 ? (
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
                  <col className="positions-col--amount" />
                  <col className="positions-col--reward" />
                  <col className="positions-col--lock" />
                  <col className="positions-col--actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Vault</th>
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
                  {sortedV2Positions.map((p) => (
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
                  <col className="positions-col--borrow-amount" />
                  <col className="positions-col--borrow-interest" />
                  <col className="positions-col--borrow-status" />
                  <col className="positions-col--borrow-actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="numeric-cell">Debt</th>
                    <th className="numeric-cell">Interest</th>
                    <th>Status</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {allBorrowRows.map((row) => (
                    <tr key={row.symbol}>
                      <td>
                        <span className="asset-with-icon">
                          <TokenIcon symbol={row.symbol} size={22} />
                          {row.symbol}
                        </span>
                      </td>
                      <td className="numeric-cell">{row.amount.toFixed(2)}</td>
                      <td className="numeric-cell">{row.interest.toFixed(4)}</td>
                      <td><span className="status-pill status-pill--active">Active</span></td>
                      <td className="position-actions-cell">
                        <button
                          className="row-action-btn"
                          type="button"
                          aria-label={`Repay ${row.symbol}`}
                          onClick={() => setSelectedRepayAsset(row.symbol)}
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

      <V2RepayDrawer
        open={selectedRepayAsset !== null}
        asset={selectedRepayAsset ?? 'USDC'}
        onClose={() => setSelectedRepayAsset(null)}
        onTransactionConfirmed={refreshDashboard}
      />
    </div>
  );
}
