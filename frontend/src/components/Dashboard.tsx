import { useAccount, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, stakingVaultAbi, lendingPoolAbi, priceOracleAbi } from '../config/contracts';
import { CountUp } from './CountUp';
import { TokenIcon } from './TokenIcon';
import { HealthFactorGauge } from './HealthFactorGauge';

const MAX_HF_THRESHOLD = 1_000_000;

export function Dashboard() {
  const { address } = useAccount();

  const { data, isLoading } = useReadContracts({
    contracts: address
      ? [
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'getTotalStakedByUser', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'getTotalStakedByUser', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'getHealthFactor', args: [address] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'rewardRatePerSecond', args: [CONTRACTS.usdc] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'rewardRatePerSecond', args: [CONTRACTS.eurc] },
          { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'viewPrice', args: [] },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  if (!address) return null;

  if (isLoading || !data) {
    return (
      <div className="dashboard">
        <h2>Dashboard</h2>
        <p className="text-secondary">Loading your portfolio...</p>
      </div>
    );
  }

  const stakedUsdc = Number(formatUnits((data[0]?.result as bigint) ?? 0n, 6));
  const stakedEurc = Number(formatUnits((data[1]?.result as bigint) ?? 0n, 6));
  const collateralUsdc = Number(formatUnits((data[2]?.result as bigint) ?? 0n, 6));
  const collateralEurc = Number(formatUnits((data[3]?.result as bigint) ?? 0n, 6));

  const usdcLoan = data[4]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const eurcLoan = data[5]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const usdcDebt = usdcLoan ? Number(formatUnits(usdcLoan[0] + usdcLoan[2], 6)) : 0;
  const eurcDebt = eurcLoan ? Number(formatUnits(eurcLoan[0] + eurcLoan[2], 6)) : 0;

  const hfRaw = data[6]?.result as bigint | undefined;
  const hf = hfRaw !== undefined ? Number(formatUnits(hfRaw, 18)) : 0;
  const hasLoans = hf > 0 && hf < MAX_HF_THRESHOLD;

  const usdcBaseRate = (data[7]?.result as bigint) ?? 0n;
  const eurcBaseRate = (data[8]?.result as bigint) ?? 0n;

  const oraclePrice = data[9]?.result as [bigint, bigint] | undefined;
  const eurcUsdPrice = oraclePrice ? Number(formatUnits(oraclePrice[0], 18)) : 1;

  const totalStakedUsd = stakedUsdc + stakedEurc * eurcUsdPrice;
  const totalCollateralUsd = collateralUsdc + collateralEurc * eurcUsdPrice;
  const totalBorrowedUsd = usdcDebt + eurcDebt * eurcUsdPrice;
  const netWorthUsd = totalStakedUsd + totalCollateralUsd - totalBorrowedUsd;

  const SECONDS_PER_YEAR = 31_536_000;
  const usdcApy = (Number(usdcBaseRate) * SECONDS_PER_YEAR) / 1e18 * 100;
  const eurcApy = (Number(eurcBaseRate) * SECONDS_PER_YEAR) / 1e18 * 100;
  const weightedStakingApy =
    totalStakedUsd > 0 ? (stakedUsdc * usdcApy + stakedEurc * eurcUsdPrice * eurcApy) / totalStakedUsd : 0;
  const netApy = totalStakedUsd > 0 ? weightedStakingApy : 0;

  const stakingRows = [
    { symbol: 'USDC' as const, amount: stakedUsdc, apy: usdcApy },
    { symbol: 'EURC' as const, amount: stakedEurc, apy: eurcApy },
  ].filter((row) => row.amount > 0);

  const borrowRows = [
    { symbol: 'USDC' as const, amount: usdcDebt, interest: usdcLoan ? Number(formatUnits(usdcLoan[2], 6)) : 0 },
    { symbol: 'EURC' as const, amount: eurcDebt, interest: eurcLoan ? Number(formatUnits(eurcLoan[2], 6)) : 0 },
  ].filter((row) => row.amount > 0);

  return (
    <div className="dashboard">
      <h2>Dashboard</h2>
      <p className="text-secondary">Welcome back. Here's your portfolio overview.</p>

      <HealthFactorGauge hf={hf} hasLoans={hasLoans} />

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
          <span className="banner-card__label">Net APY (Est.)</span>
          <span className="banner-card__value">
            <CountUp value={netApy} duration={1.2} suffix="%" />
          </span>
        </div>
      </div>

      <div className="positions-grid">
        <div className="positions-panel glass-panel">
          <h3>Your Staking Positions</h3>
          {stakingRows.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">No Stakes Yet</span>
              <span className="empty-state__subtitle">Stake assets from your wallet to open a position</span>
            </div>
          ) : (
            <table className="positions-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Amount</th>
                  <th>APY</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stakingRows.map((row) => (
                  <tr key={row.symbol}>
                    <td>
                      <span className="asset-with-icon">
                        <TokenIcon symbol={row.symbol} size={22} />
                        {row.symbol}
                      </span>
                    </td>
                    <td>{row.amount.toFixed(2)}</td>
                    <td>{row.apy.toFixed(2)}%</td>
                    <td><button className="row-action-btn">Manage</button></td>
                  </tr>
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
                    <td><button className="row-action-btn row-action-btn--danger">Repay</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
