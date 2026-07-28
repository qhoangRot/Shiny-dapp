import { formatUnits } from 'viem';
import { CONTRACTS } from '../config/contracts';

export type CreditTier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond';

export interface ScorePosition {
  asset: string;
  principal: bigint;
  tier: number;
  startTime: bigint;
}

export interface CreditBreakdown {
  stakeActivity: number;
  repaymentHistory: number;
  loyalty: number;
  protocolUsage: number;
  total: number;
}

export interface CreditSnapshot {
  date: Date;
  score: number;
  change: number;
  event: string;
}

export interface CreditChange {
  amount: number;
  label: string;
  date: Date;
}

export interface TierBenefits {
  bonusReward: string;
  borrowDiscount: string;
  borrowLimit: string;
  priority: string;
}

export const CREDIT_TIERS: { name: CreditTier; min: number; max: number }[] = [
  { name: 'Bronze', min: 0, max: 399 },
  { name: 'Silver', min: 400, max: 599 },
  { name: 'Gold', min: 600, max: 799 },
  { name: 'Diamond', min: 800, max: 1000 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function valueInUsd(position: ScorePosition, eurUsdPrice: number) {
  const amount = Number(formatUnits(position.principal, 6));
  return position.asset.toLowerCase() === CONTRACTS.eurc.toLowerCase()
    ? amount * eurUsdPrice
    : amount;
}

export function calculateCreditBreakdown(
  positions: ScorePosition[],
  eurUsdPrice: number,
): CreditBreakdown {
  if (positions.length === 0) {
    return {
      stakeActivity: 0,
      repaymentHistory: 0,
      loyalty: 0,
      protocolUsage: 0,
      total: 0,
    };
  }

  const nowSeconds = Date.now() / 1000;
  const totalStakedUsd = positions.reduce(
    (sum, position) => sum + valueInUsd(position, eurUsdPrice),
    0,
  );
  const assetCount = new Set(positions.map((position) => position.asset.toLowerCase())).size;
  const averageAgeDays =
    positions.reduce(
      (sum, position) => sum + Math.max(0, nowSeconds - Number(position.startTime)) / 86_400,
      0,
    ) / positions.length;
  const averageTier =
    positions.reduce((sum, position) => sum + position.tier, 0) / positions.length;
  const highestTier = Math.max(...positions.map((position) => position.tier));

  const stakeActivity = clamp(
    (Math.log10(totalStakedUsd + 1) / Math.log10(10_001)) * 220 +
      Math.min(60, positions.length * 15) +
      (assetCount > 1 ? 20 : 0) +
      highestTier * 25,
    0,
    350,
  );
  const loyalty = clamp(
    Math.min(140, (averageAgeDays / 365) * 140) + averageTier * 30,
    0,
    200,
  );
  const protocolUsage = clamp(
    Math.min(72, positions.length * 18) +
      Math.min(40, assetCount * 20) +
      Math.min(38, (averageAgeDays / 180) * 38),
    0,
    150,
  );

  // Repayment events are not indexed by the current MVP. Do not invent them.
  const repaymentHistory = 0;
  const total = stakeActivity + repaymentHistory + loyalty + protocolUsage;

  return { stakeActivity, repaymentHistory, loyalty, protocolUsage, total };
}

export function tierForScore(score: number): CreditTier {
  return CREDIT_TIERS.find((tier) => score >= tier.min && score <= tier.max)?.name ?? 'Bronze';
}

export function benefitsForTier(tier: CreditTier): TierBenefits {
  switch (tier) {
    case 'Diamond':
      return {
        bonusReward: '+1.5% APY',
        borrowDiscount: '−0.5% APR',
        borrowLimit: 'Up to 80% LTV',
        priority: 'Priority 1–10',
      };
    case 'Gold':
      return {
        bonusReward: '+1.0% APY',
        borrowDiscount: '—',
        borrowLimit: 'Standard LTV',
        priority: 'Standard queue',
      };
    case 'Silver':
      return {
        bonusReward: '+0.5% APY',
        borrowDiscount: '—',
        borrowLimit: 'Standard LTV',
        priority: 'Standard queue',
      };
    default:
      return {
        bonusReward: 'None',
        borrowDiscount: '—',
        borrowLimit: 'Standard LTV',
        priority: 'Standard queue',
      };
  }
}

export function buildCreditChanges(positions: ScorePosition[]): CreditChange[] {
  return [...positions]
    .sort((a, b) => Number(b.startTime - a.startTime))
    .slice(0, 4)
    .map((position) => {
      const tierLabel = ['Flexible', 'Growth', 'Diamond'][position.tier] ?? 'vault';
      return {
        amount: clamp(10 + position.tier * 10, 1, 50),
        label: `Opened ${tierLabel} stake`,
        date: new Date(Number(position.startTime) * 1000),
      };
    });
}

export function buildCreditHistory(
  positions: ScorePosition[],
  currentScore: number,
): CreditSnapshot[] {
  const ordered = [...positions]
    .sort((a, b) => Number(a.startTime - b.startTime))
    .slice(-5);
  if (ordered.length === 0) return [];

  const changes = ordered.map((position) => clamp(10 + position.tier * 10, 1, 50));
  const totalRecentChange = changes.reduce((sum, change) => sum + change, 0);
  let running = Math.max(0, currentScore - totalRecentChange);

  return ordered.map((position, index) => {
    running = index === ordered.length - 1
      ? currentScore
      : Math.min(currentScore, running + changes[index]);
    return {
      date: new Date(Number(position.startTime) * 1000),
      score: running,
      change: changes[index],
      event: `Opened ${['Flexible', 'Growth', 'Diamond'][position.tier] ?? 'vault'} stake`,
    };
  });
}
