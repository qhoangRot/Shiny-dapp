import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReadContracts } from 'wagmi';
import {
  REWARD_DISTRIBUTOR_ADDRESS,
  rewardDistributorAbi,
} from '../config/contracts';
import type { StakePosition } from './usePositions';

export interface PositionRewardState {
  amount: bigint;
  annualRateBps: bigint;
  isActive: boolean;
}

const INACTIVE_REWARD: PositionRewardState = {
  amount: 0n,
  annualRateBps: 0n,
  isActive: false,
};

function rateKey(position: Pick<StakePosition, 'asset' | 'tier'>) {
  return `${position.asset.toLowerCase()}:${position.tier}`;
}

export function usePositionRewards(
  positions: Pick<StakePosition, 'id' | 'asset' | 'tier'>[],
) {
  const retryTimerRef = useRef<number | null>(null);

  const rateEntries = useMemo(() => {
    const uniqueRates = new Map<string, Pick<StakePosition, 'asset' | 'tier'>>();
    for (const position of positions) {
      uniqueRates.set(rateKey(position), {
        asset: position.asset,
        tier: position.tier,
      });
    }
    return [...uniqueRates.entries()];
  }, [positions]);

  const contracts = useMemo(() => {
    if (!REWARD_DISTRIBUTOR_ADDRESS) return [];

    return [
      ...positions.map((position) => ({
        address: REWARD_DISTRIBUTOR_ADDRESS,
        abi: rewardDistributorAbi,
        functionName: 'pendingReward' as const,
        args: [position.id] as const,
      })),
      ...rateEntries.map(([, rate]) => ({
        address: REWARD_DISTRIBUTOR_ADDRESS,
        abi: rewardDistributorAbi,
        functionName: 'currentAnnualRateBps' as const,
        args: [rate.asset, rate.tier] as const,
      })),
    ];
  }, [positions, rateEntries]);

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useReadContracts({
    contracts,
    query: {
      enabled: Boolean(REWARD_DISTRIBUTOR_ADDRESS) && positions.length > 0,
      staleTime: 4_000,
      refetchInterval: 8_000,
      refetchIntervalInBackground: false,
    },
  });

  const rewardsByPositionId = useMemo(() => {
    const rateByKey = new Map<string, bigint>();
    rateEntries.forEach(([key], index) => {
      const result = data?.[positions.length + index]?.result;
      rateByKey.set(key, typeof result === 'bigint' ? result : 0n);
    });

    const rewards = new Map<string, PositionRewardState>();
    positions.forEach((position, index) => {
      const pendingResult = data?.[index]?.result;
      const amount = typeof pendingResult === 'bigint' ? pendingResult : 0n;
      const annualRateBps = rateByKey.get(rateKey(position)) ?? 0n;

      rewards.set(position.id.toString(), {
        amount,
        annualRateBps,
        isActive: Boolean(REWARD_DISTRIBUTOR_ADDRESS)
          && (annualRateBps > 0n || amount > 0n),
      });
    });

    return rewards;
  }, [data, positions, rateEntries]);

  const getReward = useCallback(
    (positionId: bigint) => (
      rewardsByPositionId.get(positionId.toString()) ?? INACTIVE_REWARD
    ),
    [rewardsByPositionId],
  );

  const refetchRewards = useCallback(async () => {
    if (!REWARD_DISTRIBUTOR_ADDRESS || positions.length === 0) return;
    await refetch();
  }, [positions.length, refetch]);

  const refreshAfterClaim = useCallback(async () => {
    await refetchRewards();

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }

    retryTimerRef.current = window.setTimeout(() => {
      void refetchRewards();
      retryTimerRef.current = null;
    }, 700);
  }, [refetchRewards]);

  useEffect(() => () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }
  }, []);

  return {
    distributorAddress: REWARD_DISTRIBUTOR_ADDRESS,
    getReward,
    isLoading: Boolean(REWARD_DISTRIBUTOR_ADDRESS)
      && positions.length > 0
      && isLoading,
    isError,
    refetchRewards,
    refreshAfterClaim,
  };
}
