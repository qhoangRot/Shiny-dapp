import { formatUnits } from 'viem';

const TOKEN_DECIMALS = 6;
const SMALL_REWARD_THRESHOLD = 10_000n;

export function formatRewardAmount(value: bigint): string {
  if (value === 0n) return '0.0000';

  const amount = Number(formatUnits(value, TOKEN_DECIMALS));
  if (value < 10_000n) return amount.toFixed(6);
  return amount.toFixed(4);
}

export function formatRewardDisplay(
  value: bigint,
  symbol: string,
): { label: string; exactLabel: string } {
  const exactLabel = `${formatUnits(value, TOKEN_DECIMALS)} ${symbol}`;

  if (value > 0n && value < SMALL_REWARD_THRESHOLD) {
    return {
      label: `< 0.01 ${symbol} · accruing`,
      exactLabel: `Exact accrued reward: ${exactLabel}`,
    };
  }

  return {
    label: `${formatRewardAmount(value)} ${symbol}`,
    exactLabel: `Exact accrued reward: ${exactLabel}`,
  };
}
