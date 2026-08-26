import { TESTNET_ORACLE } from '../config/contracts';
import { useAnalyticsData } from '../hooks/useAnalyticsData';
import { DataStatusBanner } from './DataStatusBanner';
import { InfoTip } from './InfoTip';
import { TokenIcon } from './TokenIcon';

function formatUsd(value: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatToken(value: number, symbol: 'USDC' | 'EURC', digits = 4) {
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })} ${symbol}`;
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

function Overview({ data }: { data: ReturnType<typeof useAnalyticsData> }) {
  const state = utilizationState(data.utilization);
  return (
    <div className="analytics-overview">
      <article className="analytics-metric glass-panel">
        <span>
          Protocol Assets
          <InfoTip text="Active staking principal plus live lending-pool liquidity and outstanding tracked debt, converted with the current EUR/USD testnet oracle." />
        </span>
        <strong><MetricValue loading={data.isLoading}>{formatUsd(data.totalTvlUsd)}</MetricValue></strong>
        <small>{formatUsd(data.stakedUsd)} staked · {formatUsd(data.lendingSupplyUsd)} lending</small>
      </article>
      <article className="analytics-metric glass-panel">
        <span>Outstanding Debt</span>
        <strong><MetricValue loading={data.isLoading}>{formatUsd(data.totalBorrowedUsd)}</MetricValue></strong>
        <small>{data.activeLoans} active loan{data.activeLoans === 1 ? '' : 's'} across {data.borrowerCount} borrower{data.borrowerCount === 1 ? '' : 's'}</small>
      </article>
      <article className="analytics-metric glass-panel">
        <span>Utilization Rate <InfoTip text="Outstanding tracked debt divided by live pool liquidity plus that debt." /></span>
        <strong><MetricValue loading={data.isLoading}>{data.utilization.toFixed(1)}%</MetricValue></strong>
        <div className="utilization-track"><i style={{ width: `${Math.min(100, data.utilization)}%` }} /></div>
        <small className={`status-text status-text--${state.tone}`}>● {state.label} · healthy below 70%</small>
      </article>
      <article className="analytics-metric glass-panel">
        <span>
          Projected Interest (30d)
          <InfoTip text="Projection based on current outstanding debt and configured borrow APR. This is not historical realized revenue." />
        </span>
        <strong><MetricValue loading={data.isLoading}>{formatUsd(data.projectedInterest30d, 4)}</MetricValue></strong>
        <small>Forward estimate from current on-chain rates</small>
      </article>
    </div>
  );
}

function PoolCard({
  symbol,
  available,
  borrowed,
  supply,
  utilization,
  borrowApr,
}: {
  symbol: 'USDC' | 'EURC';
  available: number;
  borrowed: number;
  supply: number;
  utilization: number;
  borrowApr: number;
}) {
  const state = utilizationState(utilization);
  return (
    <article className="analytics-card pool-card glass-panel">
      <div className="pool-card__title">
        <span><TokenIcon symbol={symbol} size={28} />{symbol} Lending Market</span>
        <span className={`status-text status-text--${state.tone}`}>● {state.label}</span>
      </div>
      <div className="pool-stat-grid">
        <div><span>Pool assets</span><strong>{formatToken(supply, symbol)}</strong></div>
        <div><span>Outstanding</span><strong>{formatToken(borrowed, symbol)}</strong></div>
        <div><span>Available</span><strong>{formatToken(available, symbol)}</strong></div>
      </div>
      <div className="utilization-track"><i style={{ width: `${Math.min(100, utilization)}%` }} /></div>
      <dl className="analytics-detail-list">
        <div><dt>Borrow APR</dt><dd>{borrowApr.toFixed(2)}%</dd></div>
        <div><dt>Utilization</dt><dd>{utilization.toFixed(2)}%</dd></div>
        <div><dt>Liquidity status</dt><dd className={`status-text--${state.tone}`}>{state.label}</dd></div>
      </dl>
    </article>
  );
}

function CapitalReserves({ data }: { data: ReturnType<typeof useAnalyticsData> }) {
  return (
    <div className="analytics-three-grid">
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Staking Reserve</span>
        <strong className="analytics-card__value">{formatUsd(data.stakedUsd)}</strong>
        <dl className="analytics-detail-list">
          <div><dt>USDC principal</dt><dd>{formatToken(data.stakedUsdc, 'USDC')}</dd></div>
          <div><dt>EURC principal</dt><dd>{formatToken(data.stakedEurc, 'EURC')}</dd></div>
          <div><dt>Active positions</dt><dd>{data.activePositions.length}</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Funded Reward Reserve</span>
        <strong className="analytics-card__value">{formatUsd(data.rewardReserveUsd)}</strong>
        <dl className="analytics-detail-list">
          <div><dt>USDC reserve</dt><dd>{formatToken(data.rewardReserveUsdc, 'USDC')}</dd></div>
          <div><dt>EURC reserve</dt><dd>{formatToken(data.rewardReserveEurc, 'EURC')}</dd></div>
          <div><dt>Revenue routing</dt><dd className={data.rewardDistributorConfigured ? 'status-text--safe' : 'status-text--warning'}>{data.rewardDistributorConfigured ? '● Online' : 'Not configured'}</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Pending Insurance Reserve</span>
        <strong className="analytics-card__value">{formatUsd(data.insuranceUsd, 4)}</strong>
        <dl className="analytics-detail-list">
          <div><dt>USDC pending</dt><dd>{formatToken(data.insuranceUsdc, 'USDC')}</dd></div>
          <div><dt>EURC pending</dt><dd>{formatToken(data.insuranceEurc, 'EURC')}</dd></div>
          <div><dt>Source</dt><dd>Forfeited vault rewards</dd></div>
        </dl>
      </article>
    </div>
  );
}

function ProtocolState({ data }: { data: ReturnType<typeof useAnalyticsData> }) {
  const oracleAgeSeconds = data.oracleUpdatedAt > 0
    ? Math.max(0, (Date.now() - data.oracleUpdatedAt) / 1_000)
    : Number.POSITIVE_INFINITY;
  const oracleStale = oracleAgeSeconds > data.oracleMaxStaleness;
  const protocolOwner = data.vaultOwner === data.lendingOwner && data.vaultOwner === data.oracleOwner
    ? data.vaultOwner
    : 'Multiple owner accounts';
  return (
    <div className="analytics-three-grid infrastructure-grid">
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Risk Parameters</span>
        <dl className="analytics-detail-list">
          <div><dt>Max LTV</dt><dd>{data.maxLtv.toFixed(2)}%</dd></div>
          <div><dt>Liquidation threshold</dt><dd>{data.liquidationThreshold.toFixed(2)}%</dd></div>
          <div><dt>Liquidation bonus</dt><dd>{data.liquidationBonus.toFixed(2)}%</dd></div>
          <div><dt>Repay / liquidation</dt><dd>Always callable</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Contract Status</span>
        <dl className="analytics-detail-list">
          <div><dt>Staking Vault</dt><dd className={data.vaultPaused ? 'status-text--danger' : 'status-text--safe'}>{data.vaultPaused ? 'Paused' : '● Online'}</dd></div>
          <div><dt>Lending Pool</dt><dd className={data.lendingPaused ? 'status-text--danger' : 'status-text--safe'}>{data.lendingPaused ? 'Paused' : '● Online'}</dd></div>
          <div><dt>Reward reserve</dt><dd className={data.rewardDistributorConfigured ? 'status-text--safe' : 'status-text--warning'}>{data.rewardDistributorConfigured ? '● Online' : 'Not configured'}</dd></div>
          <div><dt>Deployment</dt><dd>Direct · not proxy</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Oracle Status</span>
        <dl className="analytics-detail-list">
          <div><dt>{TESTNET_ORACLE.pair}</dt><dd>{data.eurUsdPrice.toFixed(4)}</dd></div>
          <div><dt>Provider</dt><dd>Owner-managed testnet feed</dd></div>
          <div><dt>Status</dt><dd className={data.oraclePaused || oracleStale ? 'status-text--danger' : 'status-text--safe'}>{data.oraclePaused ? 'Paused' : oracleStale ? 'Stale' : '● Live'}</dd></div>
          <div><dt>Updated</dt><dd>{formatDate(data.oracleUpdatedAt)}</dd></div>
          <div><dt>Max staleness</dt><dd>{Math.round(data.oracleMaxStaleness / 86_400)} days</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Protocol Activity</span>
        <dl className="analytics-detail-list">
          <div><dt>Tracked stakers</dt><dd>{data.userCount}</dd></div>
          <div><dt>Active positions</dt><dd>{data.activePositions.length}</dd></div>
          <div><dt>Tracked borrowers</dt><dd>{data.borrowerCount}</dd></div>
          <div><dt>Active loans</dt><dd>{data.activeLoans}</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Vault Mix</span>
        <dl className="analytics-detail-list">
          <div><dt>Flexible</dt><dd>{data.tierPositions[0]} positions</dd></div>
          <div><dt>Growth</dt><dd>{data.tierPositions[1]} positions</dd></div>
          <div><dt>Diamond</dt><dd>{data.tierPositions[2]} positions</dd></div>
        </dl>
      </article>
      <article className="analytics-card glass-panel">
        <span className="card-kicker">Administration</span>
        <dl className="analytics-detail-list">
          <div><dt>Protocol owner</dt><dd className="mono">{protocolOwner}</dd></div>
          <div><dt>Vault owner</dt><dd className="mono">{data.rewardDistributorOwner}</dd></div>
          <div><dt>Governance</dt><dd>Owner account · testnet</dd></div>
        </dl>
      </article>
    </div>
  );
}

function CreditDistribution({ data }: { data: ReturnType<typeof useAnalyticsData> }) {
  return (
    <article className="analytics-card glass-panel">
      <div className="card-heading-row">
        <div>
          <h3>Current Staker Tier Estimate</h3>
          <span className="card-meta">Derived from current active staking positions · preview model</span>
        </div>
        <span className="card-meta">Tracked wallets: {data.userCount}</span>
      </div>
      <div className="distribution-list">
        {Object.entries(data.distribution).map(([tier, count]) => {
          const percent = data.userCount > 0 ? (count / data.userCount) * 100 : 0;
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
  const data = useAnalyticsData();
  return (
    <section className="protocol-page protocol-page--wide">
      <div className="protocol-page__heading">
        <div>
          <span className="section-eyebrow">Arc Testnet</span>
          <h2>Protocol Analytics</h2>
          <p className="text-secondary">A live on-chain snapshot of capital, lending risk, funded rewards, and contract health.</p>
        </div>
        <span className="market-sync">
          {data.isFetching ? 'Syncing…' : `Updated · ${formatDate(data.dataUpdatedAt)}`}
        </span>
      </div>

      <DataStatusBanner stale={data.isError} refreshing={data.isFetching} onRefresh={() => void data.refetch()} />

      <div className="testnet-data-note">
        <span className="simulated-badge">Live on-chain snapshot</span>
        <span>Legacy (V1) positions are not included in this view. Historical charts will appear once the event indexer is deployed.</span>
      </div>

      <Overview data={data} />

      <div className="analytics-two-grid">
        <PoolCard
          symbol="USDC"
          available={data.poolUsdcAvailable}
          borrowed={data.borrowedUsdc}
          supply={data.usdcPoolSupply}
          utilization={data.usdcUtilization}
          borrowApr={data.usdcBorrowApr}
        />
        <PoolCard
          symbol="EURC"
          available={data.poolEurcAvailable}
          borrowed={data.borrowedEurc}
          supply={data.eurcPoolSupply}
          utilization={data.eurcUtilization}
          borrowApr={data.eurcBorrowApr}
        />
      </div>

      <CapitalReserves data={data} />
      <ProtocolState data={data} />
      <CreditDistribution data={data} />

      <p className="analytics-method-note">
        Coverage: active positions are read directly from StakingVault. Current debt is reconstructed from LendingPool loan state for accounts discoverable through those positions, including interest accrued since the last checkpoint. A protocol event indexer remains the next step for complete historical and collateral-only borrower coverage.
      </p>
    </section>
  );
}
