import { useState } from 'react';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, stakingVaultAbi, lendingPoolAbi, priceOracleAbi } from '../config/contracts';
import { CountUp } from './CountUp';
import { TokenIcon } from './TokenIcon';
import { HealthFactorGauge } from './HealthFactorGauge';
import { usePositions, type StakePosition } from '../hooks/usePositions';
import { StakeDrawer } from './StakeDrawer';
import { BorrowDrawer } from './BorrowDrawer';

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
  variant,
  onDone,
}: {
  positionId: bigint;
  action: 'claimReward' | 'withdraw';
  label: string;
  disabled?: boolean;
  variant?: 'danger';
  onDone: () => void;
}) {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleClick = () => {
    writeContract({
      address: CONTRACTS.stakingVault,
      abi: stakingVaultAbi,
      functionName: action,
      args: [positionId],
    });
  };

  if (isSuccess) {
    onDone();
  }

  let text = label;
  if (isPending) text = 'Confirm in wallet…';
  else if (isConfirming) text = 'Processing…';
  else if (isSuccess) text = 'Done ✓';

  return (
    <button
      className={`row-action-btn ${variant === 'danger' ? 'row-action-btn--danger' : ''}`}
      onClick={handleClick}
      disabled={disabled || isPending || isConfirming}
      title={error ? error.message : undefined}
    >
      {text}
    </button>
  );
}

function StakePositionRow({ position, onDone }: { position: StakePosition; onDone: () => void }) {
  const symbol = tokenSymbol(position.asset);
  const amount = Number(formatUnits(position.principal, 6));
  const reward = Number(formatUnits(position.pendingReward, 6));
  const isLocked = position.unlockTime > 0n && BigInt(Math.floor(Date.now() / 1000)) < position.unlockTime;

  return (
    <tr>
      <td>
        <span className="asset-with-icon">
          <TokenIcon symbol={symbol} size={22} />
          {symbol}
        </span>
      </td>
      <td>{TIER_LABELS[position.tier] ?? '—'}</td>
      <td>{amount.toFixed(2)}</td>
      <td>{reward.toFixed(4)}</td>
      <td>
        {isLocked ? (
          <span className="text-secondary" style={{ fontSize: '0.78rem' }}>
            Locked until {new Date(Number(position.unlockTime) * 1000).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-secondary" style={{ fontSize: '0.78rem' }}>Unlocked</span>
        )}
      </td>
      <td style={{ display: 'flex', gap: 8 }}>
        <PositionActionButton
          positionId={position.id}
          action="claimReward"
          label="Claim"
          disabled={position.pendingReward === 0n}
          onDone={onDone}
        />
        <PositionActionButton
          positionId={position.id}
          action="withdraw"
          label="Withdraw"
          disabled={isLocked}
          variant="danger"
          onDone={onDone}
        />
      </td>
    </tr>
  );
}

export function Dashboard() {
  const { address } = useAccount();
  const { positions, isLoading: positionsLoading, refetch: refetchPositions } = usePositions();
  const [refreshTick, setRefreshTick] = useState(0);
  const [stakeDrawerOpen, setStakeDrawerOpen] = useState(false);
  const [borrowDrawerOpen, setBorrowDrawerOpen] = useState(false);

  const { data, isLoading } = useReadContracts({
    contracts: address
      ? [
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'getHealthFactor', args: [address] },
          { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'viewPrice', args: [] },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

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

  const oraclePrice = data[5]?.result as [bigint, bigint] | undefined;
  const eurcUsdPrice = oraclePrice ? Number(formatUnits(oraclePrice[0], 18)) : 1;

  const stakedUsdc = positions
    .filter((p) => tokenSymbol(p.asset) === 'USDC')
    .reduce((sum, p) => sum + Number(formatUnits(p.principal, 6)), 0);
  const stakedEurc = positions
    .filter((p) => tokenSymbol(p.asset) === 'EURC')
    .reduce((sum, p) => sum + Number(formatUnits(p.principal, 6)), 0);

  const totalStakedUsd = stakedUsdc + stakedEurc * eurcUsdPrice;
  const totalCollateralUsd = collateralUsdc + collateralEurc * eurcUsdPrice;
  const totalBorrowedUsd = usdcDebt + eurcDebt * eurcUsdPrice;
  const netWorthUsd = totalStakedUsd + totalCollateralUsd - totalBorrowedUsd;

  const borrowRows = [
    { symbol: 'USDC' as const, amount: usdcDebt, interest: usdcLoan ? Number(formatUnits(usdcLoan[2], 6)) : 0 },
    { symbol: 'EURC' as const, amount: eurcDebt, interest: eurcLoan ? Number(formatUnits(eurcLoan[2], 6)) : 0 },
  ].filter((row) => row.amount > 0);

  function handleActionDone() {
    // Cho 1 nhip de block moi duoc mine truoc khi refetch, tranh doc lai du lieu cu
    setTimeout(() => {
      refetchPositions();
      setRefreshTick((t) => t + 1);
    }, 1500);
  }

  return (
    <div className="dashboard" key={refreshTick}>
      <h2>Dashboard</h2>
      <p className="text-secondary">Welcome back. Here's your portfolio overview.</p>

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
        <div className="banner-card glass-panel">
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
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Vault</th>
                  <th>Amount</th>
                  <th>Reward</th>
                  <th>Lock</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <StakePositionRow key={p.id.toString()} position={p} onDone={handleActionDone} />
                ))}
              </tbody>
            </table>
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
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Amount</th>
                  <th>Interest</th>
                  <th></th>
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
                    <td>{row.amount.toFixed(2)}</td>
                    <td>{row.interest.toFixed(4)}</td>
                    <td><button className="row-action-btn row-action-btn--danger" disabled>Repay (sắp có)</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <StakeDrawer
        open={stakeDrawerOpen}
        onClose={() => {
          setStakeDrawerOpen(false);
          handleActionDone();
        }}
      />

      <BorrowDrawer
        open={borrowDrawerOpen}
        onClose={() => {
          setBorrowDrawerOpen(false);
          handleActionDone();
        }}
      />
    </div>
  );
}
