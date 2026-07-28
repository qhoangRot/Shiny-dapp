import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAccount,
  usePublicClient,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { formatUnits } from 'viem';
import {
  CONTRACTS,
  REWARD_DISTRIBUTOR_ADDRESS,
  TESTNET_ORACLE,
  lendingPoolAbi,
  priceOracleAbi,
  rewardDistributorAbi,
  stakingVaultAbi,
} from '../config/contracts';
import { CountUp } from './CountUp';
import { TokenIcon } from './TokenIcon';
import { HealthFactorGauge } from './HealthFactorGauge';
import { InfoTip } from './InfoTip';
import { usePositions, type StakePosition } from '../hooks/usePositions';
import {
  usePositionRewards,
  type PositionRewardState,
} from '../hooks/usePositionRewards';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { formatRewardDisplay } from '../lib/rewards';
import { StakeDrawer } from './StakeDrawer';
import { BorrowDrawer } from './BorrowDrawer';
import { RepayDrawer } from './RepayDrawer';

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
  action: 'claimReward' | 'withdraw';
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  onWithdrawBlocked?: () => void | Promise<void>;
  onDone: () => void | Promise<void>;
}) {
  const publicClient = usePublicClient();
  const {
    writeContract,
    data: hash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash });
  const syncedHash = useRef<`0x${string}` | undefined>(undefined);
  const resetTimerRef = useRef<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCheckingRewards, setIsCheckingRewards] = useState(false);
  const [preflightMessage, setPreflightMessage] = useState<string | null>(null);
  const error = writeError ?? receiptError;

  const handleClick = async () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setPreflightMessage(null);

    if (action === 'claimReward') {
      if (!REWARD_DISTRIBUTOR_ADDRESS) return;
      writeContract({
        address: REWARD_DISTRIBUTOR_ADDRESS,
        abi: rewardDistributorAbi,
        functionName: 'claimReward',
        args: [positionId],
      });
      return;
    }

    if (REWARD_DISTRIBUTOR_ADDRESS) {
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

        if (pendingReward > 0n) {
          setPreflightMessage('Reward pending');
          await onWithdrawBlocked?.();
          resetTimerRef.current = window.setTimeout(() => {
            setPreflightMessage(null);
            resetTimerRef.current = null;
          }, 3_000);
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

    writeContract({
      address: CONTRACTS.stakingVault,
      abi: stakingVaultAbi,
      functionName: 'withdraw',
      args: [positionId],
    });
  };

  useEffect(() => {
    if (!isSuccess || !hash || syncedHash.current === hash) return;
    syncedHash.current = hash;
    setIsSyncing(true);

    void Promise.resolve(onDone())
      .catch(() => undefined)
      .finally(() => {
        setIsSyncing(false);
        resetTimerRef.current = window.setTimeout(() => {
          reset();
          syncedHash.current = undefined;
          resetTimerRef.current = null;
        }, 1_200);
      });
  }, [hash, isSuccess, onDone, reset]);

  useEffect(() => {
    if (!error) return;

    resetTimerRef.current = window.setTimeout(() => {
      reset();
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
          ? error.message
          : preflightMessage
            ? 'Claim the accrued reward before withdrawing this position.'
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
  const mustClaimBeforeWithdraw = reward.amount > 0n;
  const rewardDisplay = formatRewardDisplay(reward.amount, symbol);
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
          <PositionActionButton
            positionId={position.id}
            action="claimReward"
            label="Claim"
            disabled={!REWARD_DISTRIBUTOR_ADDRESS || reward.amount === 0n}
            onDone={onClaimDone}
          />
          <PositionActionButton
            positionId={position.id}
            action="withdraw"
            label="Withdraw"
            disabled={isLocked || mustClaimBeforeWithdraw}
            disabledReason={
              mustClaimBeforeWithdraw
                ? 'Claim the accrued reward first. Withdraw becomes available after the claim is confirmed.'
                : isLocked
                  ? 'This vault position is still locked.'
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
  const refreshProtocolData = useRefreshProtocolData();
  const refreshRetryRef = useRef<number | null>(null);
  const [stakeDrawerOpen, setStakeDrawerOpen] = useState(false);
  const [borrowDrawerOpen, setBorrowDrawerOpen] = useState(false);
  const [selectedRepayAsset, setSelectedRepayAsset] = useState<'USDC' | 'EURC' | null>(null);

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
    query: { enabled: !!address, refetchInterval: anyDrawerOpen ? false : 30_000 },
  });

  const refreshDashboard = useCallback(async () => {
    await Promise.all([
      refreshProtocolData(),
      refetchPositions(),
      refetchDashboardReads(),
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
      ]);
      refreshRetryRef.current = null;
    }, 700);
  }, [
    refreshProtocolData,
    refetchDashboardReads,
    refetchPositions,
  ]);

  useEffect(() => () => {
    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }
  }, []);

  if (!address) return null;

  if (isLoading || !data || positionsLoading) {
    return (
      <div className="dashboard">
        <h2>Dashboard</h2>
        <p className="text-secondary">Loading your portfolio...</p>
      </div>
    );
  }

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

  const totalStakedUsd = stakedUsdc + stakedEurc * eurcUsdPrice;
  const totalCollateralUsd = collateralUsdc + collateralEurc * eurcUsdPrice;
  const totalBorrowedUsd = usdcDebt + eurcDebt * eurcUsdPrice;
  const netWorthUsd = totalStakedUsd + totalCollateralUsd - totalBorrowedUsd;

  const borrowRows = [
    { symbol: 'USDC' as const, amount: usdcDebt, interest: usdcLoan ? Number(formatUnits(usdcLoan[2], 6)) : 0 },
    { symbol: 'EURC' as const, amount: eurcDebt, interest: eurcLoan ? Number(formatUnits(eurcLoan[2], 6)) : 0 },
  ].filter((row) => row.amount > 0);

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

      <HealthFactorGauge hf={hf} hasLoans={hasLoans} />

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
          <span className="banner-card__value">{positions.length}</span>
        </div>
      </div>

      <div className="positions-grid">
        <div className="positions-panel glass-panel">
          <h3>Your Staking Positions</h3>
          {positions.length === 0 ? (
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
                        <InfoTip text="Claimable rewards come from a separately funded testnet program, are paid in the staked token, and refresh about every 8 seconds." />
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
                      onDone={refreshDashboard}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="positions-panel glass-panel">
          <h3>Your Borrowed Positions</h3>
          {borrowRows.length === 0 ? (
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
                  {borrowRows.map((row) => (
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
        onTransactionConfirmed={refreshDashboard}
      />

      <BorrowDrawer
        open={borrowDrawerOpen}
        onClose={() => setBorrowDrawerOpen(false)}
        onTransactionConfirmed={refreshDashboard}
      />

      <RepayDrawer
        open={selectedRepayAsset !== null}
        asset={selectedRepayAsset ?? 'USDC'}
        onClose={() => setSelectedRepayAsset(null)}
        onTransactionConfirmed={refreshDashboard}
      />
    </div>
  );
}
