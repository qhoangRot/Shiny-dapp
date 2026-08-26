import { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { useReadContracts } from 'wagmi';
import { CONTRACTS, V2_CONTRACTS, lendingPoolV2Abi, stakingVaultV2Abi } from '../config/contracts';
import { BorrowDrawer } from './BorrowDrawer';
import { InfoTip } from './InfoTip';
import { StakeDrawer } from './StakeDrawer';
import { TokenIcon } from './TokenIcon';

const SECONDS_PER_YEAR = 31_536_000;
const WAD = 10n ** 18n;
const BPS_DENOMINATOR = 10_000n;
const STAKER_REVENUE_BPS = 6_500n;
const TIER_WEIGHTS = [WAD, 1_200_000_000_000_000_000n, 1_400_000_000_000_000_000n];

type MarketTab = 'stake' | 'borrow';
type Asset = 'USDC' | 'EURC';

function rateToApr(rate: bigint) {
  return Number(formatUnits(rate, 18)) * SECONDS_PER_YEAR * 100;
}

function formatAmount(value: bigint | undefined, symbol: Asset) {
  const amount = Number(formatUnits(value ?? 0n, 6));
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: symbol === 'USDC' ? 'USD' : 'EUR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function RateValue({ loading, value }: { loading: boolean; value: number }) {
  if (loading) {
    return <span className="metric-skeleton" aria-label="Loading rate" />;
  }

  return <>{value.toFixed(2)}%</>;
}

function estimatedRewardApr(
  totalDebt: bigint,
  ratePerSecond: bigint,
  totalWeightedStake: bigint,
  tierWeight: bigint,
) {
  if (totalDebt === 0n || ratePerSecond === 0n || totalWeightedStake === 0n) return 0;

  const projectedAnnualInterest = (totalDebt * ratePerSecond * BigInt(SECONDS_PER_YEAR)) / WAD;
  const projectedStakerRewards = (projectedAnnualInterest * STAKER_REVENUE_BPS) / BPS_DENOMINATOR;
  const aprBps = (projectedStakerRewards * tierWeight * BPS_DENOMINATOR) / (totalWeightedStake * WAD);
  return Number(aprBps) / 100;
}

export function MarketsPage() {
  const [tab, setTab] = useState<MarketTab>('stake');
  const [stakeDrawerOpen, setStakeDrawerOpen] = useState(false);
  const [borrowDrawerOpen, setBorrowDrawerOpen] = useState(false);
  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'totalPrincipal', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'totalPrincipal', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'maxLtvBps' },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'liquidationThresholdBps' },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'availableLiquidity', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'availableLiquidity', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'totalWeightedPrincipal', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'totalWeightedPrincipal', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'totalPerformingDebt', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'totalPerformingDebt', args: [CONTRACTS.eurc] },
    ],
    query: { refetchInterval: 30_000 },
  });

  const values = useMemo(() => {
    const result = <T,>(index: number, fallback: T) => (data?.[index]?.result as T | undefined) ?? fallback;
    return {
      usdcTvl: result(0, 0n),
      eurcTvl: result(1, 0n),
      usdcBorrowRate: result(2, 0n),
      eurcBorrowRate: result(3, 0n),
      maxLtvBps: Number(result(4, 0n)),
      liquidationThresholdBps: Number(result(5, 0n)),
      usdcLiquidity: result(6, 0n),
      eurcLiquidity: result(7, 0n),
      usdcWeightedStake: result(8, 0n),
      eurcWeightedStake: result(9, 0n),
      usdcDebt: result(10, 0n),
      eurcDebt: result(11, 0n),
    };
  }, [data]);

  const stakeRows = [
    {
      symbol: 'USDC' as const,
      asset: CONTRACTS.usdc,
      tvl: values.usdcTvl,
      estimatedAprs: TIER_WEIGHTS.map((weight) => estimatedRewardApr(values.usdcDebt, values.usdcBorrowRate, values.usdcWeightedStake, weight)),
    },
    {
      symbol: 'EURC' as const,
      asset: CONTRACTS.eurc,
      tvl: values.eurcTvl,
      estimatedAprs: TIER_WEIGHTS.map((weight) => estimatedRewardApr(values.eurcDebt, values.eurcBorrowRate, values.eurcWeightedStake, weight)),
    },
  ];
  const borrowRows = [
    { symbol: 'USDC' as const, collateral: 'EURC', rate: values.usdcBorrowRate, liquidity: values.usdcLiquidity },
    { symbol: 'EURC' as const, collateral: 'USDC', rate: values.eurcBorrowRate, liquidity: values.eurcLiquidity },
  ];

  return (
    <section className="protocol-page">
      <div className="protocol-page__heading">
        <div>
          <span className="section-eyebrow">Arc Testnet</span>
          <h2>Markets</h2>
          <p className="text-secondary">Explore stablecoin staking and borrowing opportunities.</p>
        </div>
        <span className="market-sync">{isLoading ? 'Syncing...' : 'Live data · refreshes every 30s'}</span>
      </div>

      <div className="page-tabs" role="tablist" aria-label="Market type">
        <button className={tab === 'stake' ? 'active' : ''} onClick={() => setTab('stake')} role="tab">
          Stake
        </button>
        <button className={tab === 'borrow' ? 'active' : ''} onClick={() => setTab('borrow')} role="tab">
          Borrow
        </button>
      </div>

      <div className="market-summary-grid">
        <div className="market-summary-card glass-panel">
          <span>Supported assets</span>
          <strong>2</strong>
        </div>
        <div className="market-summary-card glass-panel">
          <span>{tab === 'stake' ? 'Vault tiers' : 'Max LTV'}</span>
          <strong>{tab === 'stake' ? '3' : `${(values.maxLtvBps / 100).toFixed(0)}%`}</strong>
        </div>
        <div className="market-summary-card glass-panel">
          <span>{tab === 'stake' ? 'Reward asset' : 'Liquidation threshold'}</span>
          <strong>{tab === 'stake' ? 'Same asset' : `${(values.liquidationThresholdBps / 100).toFixed(1)}%`}</strong>
        </div>
      </div>

      <div className="protocol-table-card glass-panel">
        {tab === 'stake' ? (
          <table className="protocol-table market-table market-table--stake">
            <colgroup>
              <col className="market-table__asset-column" />
              <col className="market-table__total-column" />
              <col className="market-table__reward-column" />
              <col className="market-table__reward-column" />
              <col className="market-table__reward-column" />
              <col className="market-table__action-column" />
            </colgroup>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="numeric-cell">Total in vault</th>
                <th className="market-reward-heading">Flexible est. APR</th>
                <th className="market-reward-heading">Growth · 6m rewards</th>
                <th className="market-reward-heading">Diamond · 12m rewards</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {stakeRows.map((row) => (
                <tr key={row.symbol}>
                  <td><span className="asset-with-icon"><TokenIcon symbol={row.symbol} size={28} />{row.symbol}</span></td>
                  <td className="numeric-cell">{formatAmount(row.tvl, row.symbol)}</td>
                  {row.estimatedAprs.map((apr, index) => (
                    <td className="rate-cell market-reward-cell" key={index}>
                      {isLoading ? <span className="metric-skeleton" aria-label="Loading estimated reward APR" /> : `Est. ${apr.toFixed(2)}%`}
                    </td>
                  ))}
                  <td className="market-table__action"><button className="table-primary-action" onClick={() => setStakeDrawerOpen(true)}>Stake</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="protocol-table">
            <thead>
              <tr>
                <th>Borrow asset</th>
                <th>Collateral</th>
                <th className="numeric-cell">Borrow APR</th>
                <th className="numeric-cell">
                  Max LTV
                  <InfoTip text="Maximum loan-to-value is the largest debt allowed relative to the value of your collateral." />
                </th>
                <th className="numeric-cell">Available liquidity</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {borrowRows.map((row) => (
                <tr key={row.symbol}>
                  <td><span className="asset-with-icon"><TokenIcon symbol={row.symbol} size={28} />{row.symbol}</span></td>
                  <td>{row.collateral}</td>
                  <td className="rate-cell rate-cell--borrow numeric-cell"><RateValue loading={isLoading} value={rateToApr(row.rate)} /></td>
                  <td className="numeric-cell">{(values.maxLtvBps / 100).toFixed(0)}%</td>
                  <td className="numeric-cell">{formatAmount(row.liquidity, row.symbol)}</td>
                  <td><button className="table-primary-action" onClick={() => setBorrowDrawerOpen(true)}>Borrow</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="markets-note">
        {tab === 'stake'
          ? 'Estimated APR reflects current outstanding debt, borrow rates, and tier weight. Actual rewards are funded only after interest is repaid and settled.'
          : 'Borrow APR is derived from current lending parameters and may change with demand.'}
      </p>

      <StakeDrawer open={stakeDrawerOpen} onClose={() => setStakeDrawerOpen(false)} />
      <BorrowDrawer open={borrowDrawerOpen} onClose={() => setBorrowDrawerOpen(false)} />
    </section>
  );
}
