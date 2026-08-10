import { formatUnits } from 'viem';

const TOKEN_DECIMALS = 6;
// 0.01 tokens at 6 decimals. The contract can technically pay smaller dust
// amounts, but the interface waits until the amount is meaningful to claim.
export const MIN_CLAIMABLE_REWARD = 10_000n;

export function formatRewardAmount(value: bigint): string {
  if (value === 0n) return '0.0000';

  const amount = Number(formatUnits(value, TOKEN_DECIMALS));
  if (value < 10_000n) return amount.toFixed(6);
  return amount.toFixed(4);
}

export function formatRewardDisplay(
  value: bigint,
  symbol: string,
  isAccruing = false,
): { label: string; exactLabel: string } {
  const exactLabel = `${formatUnits(value, TOKEN_DECIMALS)} ${symbol}`;

  // Immediately after a stake, integer-based on-chain accrual can still be
  // zero for a few blocks. Show that the reward program is active instead of
  // implying that the position earns nothing.
  if ((value > 0n && value < MIN_CLAIMABLE_REWARD) || (value === 0n && isAccruing)) {
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
