import { useState } from 'react';
import { useAccount } from 'wagmi';
import { CREDIT_TIERS, type CreditBreakdown, type CreditTier, type TierBenefits } from '../lib/creditScore';
import { useCreditScore } from '../hooks/useCreditScore';
import { DataLineChart } from './DataLineChart';
import { DataStatusBanner } from './DataStatusBanner';
import { InfoTip } from './InfoTip';

const BREAKDOWN_ROWS: {
  key: keyof Omit<CreditBreakdown, 'total'>;
  label: string;
  max: number;
  tooltip: string;
}[] = [
  {
    key: 'stakeActivity',
    label: 'Stake Activity',
    max: 350,
    tooltip: 'Based on amount staked, vault mix, supported assets, and active positions.',
  },
  {
    key: 'repaymentHistory',
    label: 'Repayment History',
    max: 300,
    tooltip: 'Completed repayments and liquidation events. The MVP has no historical loan indexer yet, so missing history is never invented.',
  },
  {
    key: 'loyalty',
    label: 'Loyalty (Stake Duration)',
    max: 200,
    tooltip: 'Time-weighted stake age and longer-duration vault participation.',
  },
  {
    key: 'protocolUsage',
    label: 'Protocol Usage',
    max: 150,
    tooltip: 'Consistent use across positions and supported assets. Rapid farming patterns are not rewarded.',
  },
];

function formatDate(timestamp: number) {
  if (!timestamp) return 'Waiting for first sync';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(timestamp);
}

function tierIcon(tier: CreditTier) {
  return tier === 'Diamond' ? '◆' : tier === 'Gold' ? '●' : tier === 'Silver' ? '◐' : '○';
}

function CreditHeroCard({
  score,
  tier,
  benefits,
  loading,
  lastUpdated,
}: {
  score: number;
  tier: CreditTier;
  benefits: TierBenefits;
  loading: boolean;
  lastUpdated: number;
}) {
  return (
    <article className="credit-hero glass-panel">
      <div className="card-heading-row">
        <div>
          <span className="card-kicker">Credit Score</span>
          <span className="credit-snapshot">Testnet model · {formatDate(lastUpdated)}</span>
        </div>
        <span className="model-badge">Preview model</span>
      </div>

      <div className="credit-hero__score">
        {loading ? <span className="metric-skeleton metric-skeleton--score" /> : <strong>{score}</strong>}
        <span>/ 1000</span>
      </div>
      <div className={`credit-tier credit-tier--${tier.toLowerCase()}`}>
        <span>{tierIcon(tier)}</span>
        {tier}
      </div>
      <p className="credit-model-note">
        Inputs are transparent; the production weighting formula remains private. Intended snapshot cadence: once per 24 hours.
      </p>

      <div className="tier-progress" aria-label={`Current credit tier: ${tier}`}>
        {CREDIT_TIERS.map((item) => {
          const achieved = score > item.max;
          const current = item.name === tier;
          const currentProgress = current
            ? ((score - item.min) / Math.max(1, item.max - item.min + 1)) * 100
            : 0;
          return (
            <div
              key={item.name}
              className={`tier-progress__step ${achieved ? 'is-achieved' : ''} ${current ? 'is-current' : ''}`}
            >
              {current && <i style={{ width: `${Math.max(2, currentProgress)}%` }} />}
              <span>{achieved ? '✓' : current ? '◆' : ''}</span>
              <small>{item.name}</small>
            </div>
          );
        })}
      </div>

      <div className="credit-benefit-strip">
        <div><span>Bonus Reward</span><strong>{benefits.bonusReward}</strong></div>
        <div><span>Borrow APR Discount</span><strong>{benefits.borrowDiscount}</strong></div>
        <div><span>Borrow Limit</span><strong>{benefits.borrowLimit}</strong></div>
      </div>
    </article>
  );
}

function ScoreBreakdownCard({
  breakdown,
  loading,
}: {
  breakdown: CreditBreakdown;
  loading: boolean;
}) {
  return (
    <article className="score-card glass-panel">
      <div className="card-heading-row">
        <h3>Credit Score Breakdown</h3>
        <span className="card-meta">
          How scoring works
          <InfoTip text="Raw protocol activity is recorded on-chain. A flexible off-chain service is planned to compute and snapshot the final score." />
        </span>
      </div>
      <div className="score-breakdown">
        {BREAKDOWN_ROWS.map((row) => {
          const value = breakdown[row.key];
          return (
            <div className="score-breakdown__row" key={row.key}>
              <div>
                <span>{row.label}<InfoTip text={row.tooltip} /></span>
                <strong>{loading ? '—' : `${value} / ${row.max}`}</strong>
              </div>
              <div
                className="score-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={row.max}
                aria-valuenow={value}
              >
                <i style={{ width: `${(value / row.max) * 100}%` }} />
              </div>
              {row.key === 'repaymentHistory' && value === 0 && (
                <small>No repayment history is indexed by the current MVP.</small>
              )}
            </div>
          );
        })}
      </div>
      <div className="score-total">
        <span>Total Credit Score</span>
        <strong>{loading ? '—' : `${breakdown.total} / 1000`}</strong>
      </div>
    </article>
  );
}

function ScoreHistoryCard({
  history,
  currentScore,
}: {
  history: ReturnType<typeof useCreditScore>['history'];
  currentScore: number;
}) {
  const chartData = history.map((snapshot) => ({
    label: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(snapshot.date),
    values: [snapshot.score],
  }));
  const trend = history.length > 1
    ? currentScore - history[0].score
    : history[0]?.change ?? 0;

  return (
    <article className="score-card glass-panel">
      <div className="card-heading-row">
        <h3>Credit Score History</h3>
        <span className="card-meta">Last {history.length} activity snapshots</span>
      </div>
      {history.length > 0 ? (
        <>
          <DataLineChart
            data={chartData}
            series={[{ label: 'Score', color: '#9B5DE5', fill: true }]}
            valueFormatter={(value) => Math.round(value).toString()}
            ariaLabel="Credit score history"
            yMin={0}
            yMax={1000}
          />
          <p className="chart-footnote">
            Trend: <strong>+{Math.max(0, trend)} pts</strong> · hover for each activity snapshot
          </p>
        </>
      ) : (
        <div className="compact-empty-state">
          <strong>No score history yet</strong>
          <span>Open a staking position to create your first contribution event.</span>
        </div>
      )}
    </article>
  );
}

function RecentChangesCard({
  changes,
}: {
  changes: ReturnType<typeof useCreditScore>['changes'];
}) {
  return (
    <article className="score-side-card glass-panel">
      <div className="card-heading-row">
        <h3>Recent Changes</h3>
        <InfoTip text="Production snapshots are limited to one update per wallet every 24 hours and a maximum ±50 points." />
      </div>
      {changes.length > 0 ? (
        <div className="credit-change-list">
          {changes.map((change, index) => (
            <div key={`${change.date.getTime()}-${index}`}>
              <strong className={change.amount < 0 ? 'is-negative' : ''}>
                {change.amount > 0 ? '+' : ''}{change.amount}
              </strong>
              <span>{change.label}<small>{change.date.toLocaleDateString('en-GB')}</small></span>
            </div>
          ))}
        </div>
      ) : (
        <p className="side-card-empty">No contributing events yet.</p>
      )}
    </article>
  );
}

function NextMilestoneCard({ score, tier }: { score: number; tier: CreditTier }) {
  const next = CREDIT_TIERS.find((item) => item.min > score);
  const currentTier = CREDIT_TIERS.find((item) => item.name === tier) ?? CREDIT_TIERS[0];
  const range = next ? next.min - currentTier.min : 1000 - currentTier.min;
  const progress = range > 0 ? ((score - currentTier.min) / range) * 100 : 100;

  return (
    <article className="score-side-card glass-panel">
      <span className="card-kicker">Next Milestone</span>
      {next ? (
        <>
          <h3>{next.min - score} pts to {tierIcon(next.name)} {next.name}</h3>
          <p>Stake for longer, diversify assets, or build verified repayment history.</p>
          <div className="score-progress"><i style={{ width: `${Math.max(0, progress)}%` }} /></div>
          <small className="milestone-scale">{score} / {next.min}</small>
        </>
      ) : (
        <>
          <h3>Highest tier reached</h3>
          <p>Maintain long-duration stakes and a clean repayment record to keep Diamond status.</p>
          <div className="score-progress"><i style={{ width: '100%' }} /></div>
        </>
      )}
    </article>
  );
}

function CurrentBenefitsCard({
  tier,
  benefits,
}: {
  tier: CreditTier;
  benefits: TierBenefits;
}) {
  const current = CREDIT_TIERS.find((item) => item.name === tier) ?? CREDIT_TIERS[0];
  return (
    <article className="score-side-card glass-panel">
      <div className="card-heading-row">
        <h3>Current Benefits</h3>
        <span className="credit-tier-label">{tierIcon(tier)} {tier}</span>
      </div>
      <ul className="benefit-list">
        <li><span>✓ Bonus Reward</span><strong>{benefits.bonusReward}</strong></li>
        <li><span>✓ Borrow Discount</span><strong>{benefits.borrowDiscount}</strong></li>
        <li><span>✓ Borrow Limit</span><strong>{benefits.borrowLimit}</strong></li>
        <li><span>✓ Queue</span><strong>{benefits.priority}</strong></li>
      </ul>
      <small>Tier range: {current.min}–{current.max}</small>
    </article>
  );
}

function ImproveScoreCard({ score }: { score: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <article className="score-side-card glass-panel">
      <h3>How to Improve</h3>
      <ul className="improve-list">
        <li>→ Stake for longer durations</li>
        <li>→ Increase your active stake</li>
        <li>→ Repay loans on time</li>
        <li>→ Avoid liquidation</li>
        <li>→ Use the protocol consistently</li>
      </ul>
      <button
        className="review-link"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`Shiny Credit Score review request · score ${score}/1000`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Review summary copied ✓' : 'Score wrong? Copy review request →'}
      </button>
    </article>
  );
}

export function CreditScorePage() {
  const { isConnected } = useAccount();
  const {
    breakdown,
    tier,
    benefits,
    changes,
    history,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    oracleTimestamp,
    refetch,
  } = useCreditScore();

  if (!isConnected) {
    return (
      <section className="protocol-page">
        <div className="page-empty-state glass-panel">
          <strong>Connect your wallet to view Credit Score</strong>
          <span>Your score is calculated from activity associated with the connected address.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="protocol-page protocol-page--wide">
      <div className="protocol-page__heading">
        <div>
          <span className="section-eyebrow">On-chain reputation</span>
          <h2>Credit Score</h2>
          <p className="text-secondary">A single 0–1000 trust score based on your protocol activity.</p>
        </div>
        <span className="market-sync">
          {isFetching ? 'Syncing…' : `Last synced ${formatDate(dataUpdatedAt)}`}
        </span>
      </div>

      <DataStatusBanner
        stale={isError}
        refreshing={isFetching}
        onRefresh={() => void refetch()}
      />

      <div className="testnet-data-note">
        <span className="simulated-badge">Testnet preview</span>
        <span>
          Legacy (V1) positions are not included in this view. Credit scoring service is not deployed yet. Current score is a transparent local model using live stake data and the
          {' '}manual EUR/USD oracle snapshot ({oracleTimestamp ? formatDate(oracleTimestamp) : 'configured baseline'}).
        </span>
      </div>

      <div className="credit-layout">
        <div className="credit-layout__main">
          <CreditHeroCard
            score={breakdown.total}
            tier={tier}
            benefits={benefits}
            loading={isLoading}
            lastUpdated={dataUpdatedAt}
          />
          <ScoreBreakdownCard breakdown={breakdown} loading={isLoading} />
          <ScoreHistoryCard history={history} currentScore={breakdown.total} />
        </div>
        <aside className="credit-layout__side">
          <RecentChangesCard changes={changes} />
          <NextMilestoneCard score={breakdown.total} tier={tier} />
          <CurrentBenefitsCard tier={tier} benefits={benefits} />
          <ImproveScoreCard score={breakdown.total} />
        </aside>
      </div>
    </section>
  );
}
