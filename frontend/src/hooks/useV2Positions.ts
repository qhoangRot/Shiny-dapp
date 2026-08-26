import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  const lastResolvedPositionsRef = useRef<V2StakePosition[]>([]);
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

  const resolvedPositions = useMemo<V2StakePosition[]>(() => {
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

  const hasCompleteDetails = positionIds.length === 0
    || (detailsRead.data?.length ?? 0) === positionIds.length;

  useEffect(() => {
    if (!address) {
      lastResolvedPositionsRef.current = [];
      return;
    }

    if (hasCompleteDetails) {
      lastResolvedPositionsRef.current = resolvedPositions;
    }
  }, [address, hasCompleteDetails, resolvedPositions]);

  // A new stake changes the query key from N positions to N + 1. Keep the
  // previously resolved rows visible while the RPC fetches the new detail row,
  // rather than briefly replacing the whole portfolio with an empty/loading UI.
  const positions = hasCompleteDetails
    ? resolvedPositions
    : lastResolvedPositionsRef.current;

  const refetch = useCallback(async () => {
    await Promise.all([idsRead.refetch(), detailsRead.refetch()]);
  }, [detailsRead, idsRead]);

  return {
    positions,
    // `isLoading` is reserved for the first portfolio read. Subsequent
    // refetches keep the existing rows rendered, preventing the dashboard
    // from flashing back to an empty/loading state after a confirmed stake.
    isLoading: Boolean(address) && idsRead.isLoading && idsRead.data === undefined,
    isError: idsRead.isError || detailsRead.isError,
    refetch,
  };
}
