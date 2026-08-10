import { useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { V2_CONTRACTS, stakingVaultV2Abi } from '../config/contracts';

export interface V2StakePosition {
  deployment: 'v2';
  id: bigint;
  key: string;
  owner: `0x${string}`;
  asset: `0x${string}`;
  tier: number;
  principal: bigint;
  startTime: bigint;
  unlockTime: bigint;
  pendingReward: bigint;
  withdrawn: boolean;
}

type PositionResult = [
  `0x${string}`, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, boolean,
];

export function useV2Positions() {
  const { address } = useAccount();
  const idsRead = useReadContract({
    address: V2_CONTRACTS.stakingVault,
    abi: stakingVaultV2Abi,
    functionName: 'userPositionIds',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), staleTime: 10_000, refetchInterval: 10_000 },
  });
  const positionIds = (idsRead.data ?? []) as bigint[];
  const detailsRead = useReadContracts({
    contracts: positionIds.map((id) => ({
      address: V2_CONTRACTS.stakingVault,
      abi: stakingVaultV2Abi,
      functionName: 'positions' as const,
      args: [id] as const,
    })),
    query: { enabled: Boolean(address) && positionIds.length > 0, staleTime: 10_000, refetchInterval: 10_000 },
  });

  const positions = useMemo<V2StakePosition[]>(() => {
    if (!address || !detailsRead.data) return [];
    const account = address.toLowerCase();
    return positionIds.flatMap((id, index) => {
      const value = detailsRead.data?.[index]?.result as PositionResult | undefined;
      if (!value) return [];
      const [owner, asset, tier, principal, stakedAt, unlockTime, pendingReward, , withdrawn] = value;
      if (withdrawn || owner.toLowerCase() !== account) return [];
      return [{ deployment: 'v2', id, key: `v2:${id}`, owner, asset, tier, principal, startTime: stakedAt, unlockTime, pendingReward, withdrawn }];
    });
  }, [address, detailsRead.data, positionIds]);

  const refetch = useCallback(async () => {
    await Promise.all([idsRead.refetch(), detailsRead.refetch()]);
  }, [detailsRead, idsRead]);

  return {
    positions,
    isLoading: Boolean(address) && (idsRead.isLoading || (positionIds.length > 0 && detailsRead.isLoading)),
    isError: idsRead.isError || detailsRead.isError,
    refetch,
  };
}
