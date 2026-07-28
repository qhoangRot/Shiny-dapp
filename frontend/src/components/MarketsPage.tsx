import { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { useReadContracts } from 'wagmi';
import { CONTRACTS, erc20Abi, lendingPoolAbi } from '../config/contracts';
import { useRewardRates } from '../hooks/useRewardRates';
import { BorrowDrawer } from './BorrowDrawer';
import { InfoTip } from './InfoTip';
import { StakeDrawer } from './StakeDrawer';
import { TokenIcon } from './TokenIcon';

const SECONDS_PER_YEAR = 31_536_000;

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

function RewardRateValue({
  loading,
  isConfigured,
  annualRateBps,
}: {
  loading: boolean;
  isConfigured: boolean;
  annualRateBps: bigint;
}) {
  if (loading) {
    return <span className="metric-skeleton" aria-label="Loading reward APR" />;
  }

  if (!isConfigured || annualRateBps === 0n) {
    return <span className="rate-inactive">Inactive</span>;
  }

  return <>{(Number(annualRateBps) / 100).toFixed(2)}%</>;
}

export function MarketsPage() {
  const [tab, setTab] = useState<MarketTab>('stake');
  const [stakeDrawerOpen, setStakeDrawerOpen] = useState(false);
  const [borrowDrawerOpen, setBorrowDrawerOpen] = useState(false);
  const {
    getAnnualRateBps,
    hasActiveProgram,
    isConfigured: rewardsConfigured,
    isLoading: rewardRatesLoading,
  } = useRewardRates();

  const { data, isLoading } = useReadContracts({
    contracts: [
      { address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.stakingVault] },
      { address: CONTRACTS.eurc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.stakingVault] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.usdc] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.eurc] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'maxLtvBps' },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'liquidationThresholdBps' },
      { address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.lendingPool] },
      { address: CONTRACTS.eurc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.lendingPool] },
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
    };
  }, [data]);

  const stakeRows = [
    { symbol: 'USDC' as const, asset: CONTRACTS.usdc, tvl: values.usdcTvl },
    { symbol: 'EURC' as const, asset: CONTRACTS.eurc, tvl: values.eurcTvl },
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
          <table className="protocol-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="numeric-cell">Total in vault</th>
                <th className="numeric-cell">Flexible APR</th>
                <th className="numeric-cell">Growth · 6m APR</th>
                <th className="numeric-cell">Diamond · 12m APR</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {stakeRows.map((row) => (
                <tr key={row.symbol}>
                  <td><span className="asset-with-icon"><TokenIcon symbol={row.symbol} size={28} />{row.symbol}</span></td>
                  <td className="numeric-cell">{formatAmount(row.tvl, row.symbol)}</td>
                  {[0, 1, 2].map((tier) => (
                    <td className="rate-cell numeric-cell" key={tier}>
                      <RewardRateValue
                        loading={rewardRatesLoading}
                        isConfigured={rewardsConfigured}
                        annualRateBps={getAnnualRateBps(row.asset, tier)}
                      />
                    </td>
                  ))}
                  <td><button className="table-primary-action" onClick={() => setStakeDrawerOpen(true)}>Stake</button></td>
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
          ? hasActiveProgram
            ? 'Reward APR is sourced from the active RewardDistributor program.'
            : 'Rewards are inactive until a RewardDistributor program is configured.'
          : 'Borrow APR is derived from current lending parameters and may change with demand.'}
      </p>

      <StakeDrawer open={stakeDrawerOpen} onClose={() => setStakeDrawerOpen(false)} />
      <BorrowDrawer open={borrowDrawerOpen} onClose={() => setBorrowDrawerOpen(false)} />
    </section>
  );
}
