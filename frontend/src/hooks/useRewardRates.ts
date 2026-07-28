import { useCallback, useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import {
  CONTRACTS,
  REWARD_DISTRIBUTOR_ADDRESS,
  rewardDistributorAbi,
} from '../config/contracts';

const RATE_TARGETS = [
  { asset: CONTRACTS.usdc, tier: 0 },
  { asset: CONTRACTS.usdc, tier: 1 },
  { asset: CONTRACTS.usdc, tier: 2 },
  { asset: CONTRACTS.eurc, tier: 0 },
  { asset: CONTRACTS.eurc, tier: 1 },
  { asset: CONTRACTS.eurc, tier: 2 },
] as const;

function rateKey(asset: string, tier: number) {
  return `${asset.toLowerCase()}:${tier}`;
}

export function useRewardRates() {
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useReadContracts({
    contracts: REWARD_DISTRIBUTOR_ADDRESS
      ? RATE_TARGETS.map(({ asset, tier }) => ({
          address: REWARD_DISTRIBUTOR_ADDRESS,
          abi: rewardDistributorAbi,
          functionName: 'currentAnnualRateBps' as const,
          args: [asset, tier] as const,
        }))
      : [],
    query: {
      enabled: Boolean(REWARD_DISTRIBUTOR_ADDRESS),
      staleTime: 4_000,
      refetchInterval: 8_000,
      refetchIntervalInBackground: false,
    },
  });

  const rates = useMemo(() => {
    const byMarket = new Map<string, bigint>();
    RATE_TARGETS.forEach(({ asset, tier }, index) => {
      const result = data?.[index]?.result;
      byMarket.set(rateKey(asset, tier), typeof result === 'bigint' ? result : 0n);
    });
    return byMarket;
  }, [data]);

  const getAnnualRateBps = useCallback(
    (asset: string, tier: number) => rates.get(rateKey(asset, tier)) ?? 0n,
    [rates],
  );
  const hasActiveProgram = [...rates.values()].some((rate) => rate > 0n);

  return {
    getAnnualRateBps,
    hasActiveProgram,
    isConfigured: Boolean(REWARD_DISTRIBUTOR_ADDRESS),
    isLoading: Boolean(REWARD_DISTRIBUTOR_ADDRESS) && isLoading,
    isError,
    refetch,
  };
}
