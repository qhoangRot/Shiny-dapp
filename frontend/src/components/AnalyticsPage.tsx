import { useMemo, useState } from 'react';
import { TESTNET_LIQUIDITY_SEED, TESTNET_ORACLE } from '../config/contracts';
import { useAnalyticsData } from '../hooks/useAnalyticsData';
import { DataLineChart } from './DataLineChart';
import { DataStatusBanner } from './DataStatusBanner';
import { InfoTip } from './InfoTip';
import { TokenIcon } from './TokenIcon';

type Timeframe = '7D' | '30D' | 'ALL';

function formatUsd(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: digits,
  }).format(value);
}

function formatToken(value: number, symbol: 'USDC' | 'EURC') {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}`;
}

function formatDate(timestamp: number) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(timestamp);
}

function utilizationState(utilization: number) {
  if (utilization > 90) return { label: 'High', tone: 'danger' };
  if (utilization >= 70) return { label: 'Moderate', tone: 'warning' };
  return { label: 'Healthy', tone: 'safe' };
}

function MetricValue({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return loading ? <span className="metric-skeleton metric-skeleton--analytics" /> : children;
}

function OverviewStats({
  loading,
  totalTvl,
  totalBorrowed,
  utilization,
  revenue,
  stakedUsdc,
  stakedEurc,
  borrowedUsdc,
  borrowedEurc,
}: {
  loading: boolean;
  totalTvl: number;
  totalBorrowed: number;
  utilization: number;
  revenue: number;
  stakedUsdc: number;
  stakedEurc: number;
  borrowedUsdc: number;
  borrowedEurc: number;
}) {
  const state = utilizationState(utilization);
  return (
    <div className="analytics-overview">
      <article className="analytics-metric glass-panel">
        <span>Total TVL <InfoTip text="Active staking principal plus configured testnet lending supply, converted with the EUR/USD oracle." /></span>
        <strong><MetricValue loading={loading}>{formatUsd(totalTvl, 2)}</MetricValue></strong>
        <small>Staked: {formatToken(stakedUsdc, 'USDC')} · {formatToken(stakedEurc, 'EURC')}</small>
      </article>
      <article className="analytics-metric glass-panel">
        <span>Total Borrowed</span>
        <strong><MetricValue loading={loading}>{formatUsd(totalBorrowed, 2)}</MetricValue></strong>
        <small>{formatToken(borrowedUsdc, 'USDC')} · {formatToken(borrowedEurc, 'EURC')}</small>
      </article>
      <article className="analytics-metric glass-panel">
        <span>Utilization Rate <InfoTip text="Borrowed value divided by the configured Arc Testnet lending seed." /></span>
        <strong><MetricValue loading={loading}>{utilization.toFixed(1)}%</MetricValue></strong>
        <div className="utilization-track"><i style={{ width: `${Math.min(100, utilization)}%` }} /></div>
        <small className={`status-text status-text--${state.tone}`}>● {state.label} · healthy below 70%</small>
      </article>
      <article className="analytics-metric glass-panel">
        <span>Estimated Revenue (30d)</span>
        <strong><MetricValue loading={loading}>{formatUsd(revenue, 4)}</MetricValue></strong>
        <small>Modelled from current debt and configured borrow APR.</small>
      </article>
    </div>
  );
}

function ChartCard({
  title,
  note,
  timeframe,
  onTimeframe,
  children,
}: {
  title: string;
  note: string;
  timeframe: Timeframe;
  onTimeframe: (timeframe: Timeframe) => void;
  children: React.ReactNode;
}) {
  return (
    <article className="analytics-card analytics-chart-card glass-panel">
      <div className="card-heading-row">
        <div>
          <h3>{title}</h3>
          <span className="card-meta">{note}</span>
        </div>
        <div className="chart-range" role="group" aria-label={`${title} range`}>
          {(['7D', '30D', 'ALL'] as Timeframe[]).map((range) => (
            <button
              type="button"
              key={range}
              className={timeframe === range ? 'active' : ''}
              onClick={() => onTimeframe(range)}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      {children}
    </article>
  );
}

function PoolCard({
  symbol,
  staked,
  available,
  borrowed,
  borrowApr,
}: {
  symbol: 'USDC' | 'EURC';
  staked: number;
  available: number;
  borrowed: number;
  borrowApr: number;
}) {
  const seed = TESTNET_LIQUIDITY_SEED[symbol];
  const utilization = seed > 0 ? (borrowed / seed) * 100 : 0;
  const state = utilizationState(utilization);
  return (
    <article className="analytics-card pool-card glass-panel">
      <div className="pool-card__title">
        <span><TokenIcon symbol={symbol} size={28} />{symbol} Pool</span>
        <span className={`status-text status-text--${state.tone}`}>● {state.label}</span>
      </div>
      <div className="pool-stat-grid">
        <div><span>TVL</span><strong>{formatToken(staked + seed, symbol)}</strong></div>
        <div><span>Borrowed</span><strong>{formatToken(borrowed, symbol)}</strong></div>
        <div><span>Available</span><strong>{formatToken(available, symbol)}</strong></div>
      </div>
      <dl className="analytics-detail-list">
        <div><dt>Staking reserve</dt><dd>{formatToken(staked, symbol)}</dd></div>
        <div><dt>Lending supply</dt><dd>{formatToken(seed, symbol)}</dd></div>
        <div><dt>Withdrawal queue</dt><dd>Coming in a later phase</dd></div>
        <div><dt>Borrow APR</dt><dd>{borrowApr.toFixed(2)}%</dd></div>
        <div><dt>Utilization</dt><dd>{utilization.toFixed(1)}%</dd></div>
      </dl>
    </article>
  );
}

function LiquidityHealth({
  stakedUsd,
  lendingUsd,
  insuranceUsd,
  activeLoans,
  borrowApr,
  utilization,
}: {
  stakedUsd: number;
  lendingUsd: number;
  insuranceUsd: number;
  activeLoans: number;
  borrowApr: number;
  utilization: number;
}) {
  return (
    <div className="analytics-three-grid">
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Staking Reserve</span>
        <strong className="analytics-card__value">{formatUsd(stakedUsd, 2)}</strong>
        <p>Active principal held by the staking vault.</p>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Lending Pool</span>
        <strong className="analytics-card__value">{formatUsd(lendingUsd, 2)}</strong>
        <dl className="analytics-detail-list">
          <div><dt>Estimated active loans</dt><dd>{activeLoans}</dd></div>
          <div><dt>Weighted borrow APR</dt><dd>{borrowApr.toFixed(2)}%</dd></div>
          <div><dt>Utilization</dt><dd>{utilization.toFixed(1)}%</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Pending Insurance Fund</span>
        <strong className="analytics-card__value">{formatUsd(insuranceUsd, 4)}</strong>
        <p>Forfeited early-withdrawal rewards tracked by the current vault. Dedicated insurance contract is a later phase.</p>
      </article>
    </div>
  );
}

function RevenueDistribution({ revenue }: { revenue: number }) {
  const buckets = [
    { label: 'Stakers', percent: 65, color: '#9B5DE5' },
    { label: 'Treasury', percent: 15, color: '#5C7CFA' },
    { label: 'Insurance Fund', percent: 10, color: '#4FD1C5' },
    { label: 'Credit Bonus', percent: 10, color: '#E8B54C' },
  ];
  return (
    <article className="analytics-card glass-panel">
      <div className="card-heading-row">
        <h3>Revenue Distribution</h3>
        <span className="card-meta">Target allocation · testnet model</span>
      </div>
      <div className="revenue-bar" aria-label="Revenue allocation">
        {buckets.map((bucket) => (
          <i key={bucket.label} style={{ width: `${bucket.percent}%`, background: bucket.color }} />
        ))}
      </div>
      <div className="revenue-grid">
        {buckets.map((bucket) => (
          <div key={bucket.label}>
            <span><i style={{ background: bucket.color }} />{bucket.label} ({bucket.percent}%)</span>
            <strong>{formatUsd((revenue * bucket.percent) / 100, 4)}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function Infrastructure({
  lendingPaused,
  vaultPaused,
  oraclePaused,
  oraclePrice,
  oracleUpdatedAt,
  oracleMaxStaleness,
  lendingOwner,
  vaultOwner,
  oracleOwner,
}: {
  lendingPaused: boolean;
  vaultPaused: boolean;
  oraclePaused: boolean;
  oraclePrice: number;
  oracleUpdatedAt: number;
  oracleMaxStaleness: number;
  lendingOwner: string;
  vaultOwner: string;
  oracleOwner: string;
}) {
  const protocolOwner = vaultOwner === lendingOwner && vaultOwner === oracleOwner
    ? vaultOwner
    : 'Multiple owner accounts';

  return (
    <div className="analytics-three-grid infrastructure-grid">
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Contract Status</span>
        <dl className="analytics-detail-list">
          <div><dt>Staking Vault</dt><dd className={vaultPaused ? 'status-text--danger' : 'status-text--safe'}>{vaultPaused ? 'Paused' : '● Online'}</dd></div>
          <div><dt>Lending Pool</dt><dd className={lendingPaused ? 'status-text--danger' : 'status-text--safe'}>{lendingPaused ? 'Paused' : '● Online'}</dd></div>
          <div><dt>Keeper</dt><dd>Coming in a later phase</dd></div>
          <div><dt>Liquidation / Repay</dt><dd>Callable</dd></div>
          <div><dt>Deployment</dt><dd>Direct · not proxy</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Oracle Status</span>
        <dl className="analytics-detail-list">
          <div><dt>EUR/USD</dt><dd>{oraclePrice.toFixed(4)}</dd></div>
          <div><dt>Provider</dt><dd>Manual · Arc Testnet</dd></div>
          <div><dt>Status</dt><dd className={oraclePaused ? 'status-text--danger' : 'status-text--safe'}>{oraclePaused ? 'Paused' : '● Live'}</dd></div>
          <div><dt>Updated</dt><dd>{formatDate(oracleUpdatedAt)}</dd></div>
          <div><dt>Valid range</dt><dd>{TESTNET_ORACLE.minPrice.toFixed(2)}–{TESTNET_ORACLE.maxPrice.toFixed(2)}</dd></div>
          <div><dt>Max staleness</dt><dd>{Math.round(oracleMaxStaleness / 86_400)} days</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Administration</span>
        <dl className="analytics-detail-list">
          <div><dt>Treasury contract</dt><dd>Coming in a later phase</dd></div>
          <div>
            <dt>Protocol Owner</dt>
            <dd className="mono">{protocolOwner} (Vault · Pool · Oracle)</dd>
          </div>
          <div><dt>Governance</dt><dd>Owner account · testnet</dd></div>
        </dl>
      </article>
    </div>
  );
}

function CreditDistribution({
  distribution,
  total,
}: {
  distribution: ReturnType<typeof useAnalyticsData>['distribution'];
  total: number;
}) {
  return (
    <article className="analytics-card glass-panel">
      <div className="card-heading-row">
        <div>
          <h3>User Tier Breakdown</h3>
          <span className="card-meta">Estimated from active stake data only</span>
        </div>
        <span className="card-meta">Total active wallets: {total}</span>
      </div>
      <div className="distribution-list">
        {Object.entries(distribution).map(([tier, count]) => {
          const percent = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={tier}>
              <span>{tier}</span>
              <div><i style={{ width: `${percent}%` }} /></div>
              <strong>{count} · {percent.toFixed(0)}%</strong>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>('ALL');
  const data = useAnalyticsData();
  const visibleHistory = useMemo(() => {
    const days = timeframe === '7D' ? 7 : timeframe === '30D' ? 30 : data.history.length;
    return data.history.slice(-days);
  }, [data.history, timeframe]);
  const chartData = visibleHistory.map((point) => ({
    label: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(point.date),
    values: [point.tvl],
  }));
  const borrowChartData = visibleHistory.map((point) => ({
    label: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(point.date),
    values: [point.supply, point.borrowed],
  }));
  const stakedUsd = data.stakedUsdc + data.stakedEurc * data.eurUsdPrice;
  const lendingUsd =
    TESTNET_LIQUIDITY_SEED.USDC + TESTNET_LIQUIDITY_SEED.EURC * data.eurUsdPrice;
  const weightedBorrowApr = data.totalBorrowedUsd > 0
    ? (
        data.borrowedUsdc * data.usdcBorrowApr +
        data.borrowedEurc * data.eurUsdPrice * data.eurcBorrowApr
      ) / data.totalBorrowedUsd
    : (data.usdcBorrowApr + data.eurcBorrowApr) / 2;

  return (
    <section className="protocol-page protocol-page--wide">
      <div className="protocol-page__heading">
        <div>
          <span className="section-eyebrow">Arc Testnet</span>
          <h2>Protocol Analytics</h2>
          <p className="text-secondary">Liquidity, lending, revenue, and infrastructure health in one view.</p>
        </div>
        <span className="market-sync">
          {data.isFetching ? 'Syncing…' : `Live state · ${formatDate(data.dataUpdatedAt)}`}
        </span>
      </div>

      <DataStatusBanner
        stale={data.isError}
        refreshing={data.isFetching}
        onRefresh={() => void data.refetch()}
      />

      <div className="testnet-data-note">
        <span className="simulated-badge">Hybrid testnet data</span>
        <span>Current balances and parameters are on-chain. Historical charts and revenue allocation are explicitly modelled because no indexer is deployed.</span>
      </div>

      <OverviewStats
        loading={data.isLoading}
        totalTvl={data.totalTvlUsd}
        totalBorrowed={data.totalBorrowedUsd}
        utilization={data.utilization}
        revenue={data.revenue30d}
        stakedUsdc={data.stakedUsdc}
        stakedEurc={data.stakedEurc}
        borrowedUsdc={data.borrowedUsdc}
        borrowedEurc={data.borrowedEurc}
      />

      <ChartCard
        title="TVL Over Time"
        note="Modelled history reconstructed from currently active positions"
        timeframe={timeframe}
        onTimeframe={setTimeframe}
      >
        <DataLineChart
          data={chartData}
          series={[{ label: 'TVL', color: '#9B5DE5', fill: true }]}
          valueFormatter={(value) => formatUsd(value)}
          ariaLabel="Protocol TVL over time"
        />
      </ChartCard>

      <ChartCard
        title="Borrow vs Supply Over Time"
        note="Current debt is on-chain; historical debt path is modelled"
        timeframe={timeframe}
        onTimeframe={setTimeframe}
      >
        <div className="chart-legend">
          <span><i style={{ background: '#9B5DE5' }} />Supply</span>
          <span><i style={{ background: '#E8B54C' }} />Borrow</span>
        </div>
        <DataLineChart
          data={borrowChartData}
          series={[
            { label: 'Supply', color: '#9B5DE5' },
            { label: 'Borrow', color: '#E8B54C', dashed: true },
          ]}
          valueFormatter={(value) => formatUsd(value)}
          ariaLabel="Borrow versus supply over time"
        />
      </ChartCard>

      <div className="analytics-two-grid">
        <PoolCard
          symbol="USDC"
          staked={data.stakedUsdc}
          available={data.poolUsdcAvailable}
          borrowed={data.borrowedUsdc}
          borrowApr={data.usdcBorrowApr}
        />
        <PoolCard
          symbol="EURC"
          staked={data.stakedEurc}
          available={data.poolEurcAvailable}
          borrowed={data.borrowedEurc}
          borrowApr={data.eurcBorrowApr}
        />
      </div>

      <LiquidityHealth
        stakedUsd={stakedUsd}
        lendingUsd={lendingUsd}
        insuranceUsd={data.insuranceUsd}
        activeLoans={data.totalBorrowedUsd > 0 ? 1 : 0}
        borrowApr={weightedBorrowApr}
        utilization={data.utilization}
      />

      <RevenueDistribution revenue={data.revenue30d} />

      <Infrastructure
        lendingPaused={data.lendingPaused}
        vaultPaused={data.vaultPaused}
        oraclePaused={data.oraclePaused}
        oraclePrice={data.eurUsdPrice}
        oracleUpdatedAt={data.oracleUpdatedAt}
        oracleMaxStaleness={data.oracleMaxStaleness}
        lendingOwner={data.lendingOwner}
        vaultOwner={data.vaultOwner}
        oracleOwner={data.oracleOwner}
      />

      <CreditDistribution distribution={data.distribution} total={data.userCount} />

      <p className="analytics-method-note">
        Method: pool debt is inferred from the configured 50 USDC / 50 EURC Arc Testnet seed minus available pool balances.
        No Stork feed, treasury, keeper, proxy, withdrawal queue, or production credit service is claimed where none exists.
      </p>
    </section>
  );
}
