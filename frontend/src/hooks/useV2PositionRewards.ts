import { useCallback, useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { V2_CONTRACTS, stakingVaultV2Abi } from '../config/contracts';
import type { V2StakePosition } from './useV2Positions';

export interface V2PositionRewardState { amount: bigint; annualRateBps: bigint; isActive: boolean; }

export function useV2PositionRewards(positions: V2StakePosition[]) {
  const read = useReadContracts({
    contracts: positions.map((position) => ({
      address: V2_CONTRACTS.stakingVault,
      abi: stakingVaultV2Abi,
      functionName: 'pendingReward' as const,
      args: [position.id] as const,
    })),
    query: { enabled: positions.length > 0, staleTime: 4_000, refetchInterval: 5_000 },
  });
  const rewards = useMemo(() => new Map(positions.map((position, index) => {
    const amount = (read.data?.[index]?.result as bigint | undefined) ?? position.pendingReward;
    return [position.key, { amount, annualRateBps: 0n, isActive: amount > 0n } satisfies V2PositionRewardState];
  })), [positions, read.data]);
  const getReward = useCallback((position: V2StakePosition) => rewards.get(position.key) ?? { amount: 0n, annualRateBps: 0n, isActive: false }, [rewards]);
  return { getReward, isLoading: positions.length > 0 && read.isLoading, isError: read.isError, refetchRewards: read.refetch };
}
