import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { CONTRACTS, stakingVaultAbi } from '../config/contracts';

export interface StakePosition {
  id: bigint;
  owner: `0x${string}`;
  asset: `0x${string}`;
  tier: number;
  principal: bigint;
  startTime: bigint;
  unlockTime: bigint;
  lastAccrualTime: bigint;
  accruedReward: bigint;
  withdrawn: boolean;
}

type PositionResult = [
  `0x${string}`,
  `0x${string}`,
  number,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
];

export function usePositions() {
  const { address } = useAccount();
  const refreshDetailsAfterCountRef = useRef(false);

  const {
    data: nextPositionId,
    isLoading: loadingPositionCount,
    isError: positionCountError,
    dataUpdatedAt: positionCountUpdatedAt,
    refetch: refetchPositionCount,
  } = useReadContract({
    address: CONTRACTS.stakingVault,
    abi: stakingVaultAbi,
    functionName: 'nextPositionId',
    query: {
      enabled: Boolean(address),
      staleTime: 15_000,
      refetchInterval: 10_000,
    },
  });

  const positionIds = useMemo(() => {
    if (!address || nextPositionId === undefined || nextPositionId <= 1n) return [];

    return Array.from(
      { length: Number(nextPositionId - 1n) },
      (_, index) => BigInt(index + 1),
    );
  }, [address, nextPositionId]);

  const {
    data,
    isLoading: loadingDetails,
    isError: positionDetailsError,
    dataUpdatedAt: positionDetailsUpdatedAt,
    refetch: refetchDetails,
  } = useReadContracts({
    contracts: positionIds.map((id) => ({
      address: CONTRACTS.stakingVault,
      abi: stakingVaultAbi,
      functionName: 'positions',
      args: [id],
    })),
    query: {
      enabled: Boolean(address) && positionIds.length > 0,
      staleTime: 15_000,
      refetchInterval: 10_000,
    },
  });

  const positions = useMemo(() => {
    if (!address || !data) return [];

    const connectedAccount = address.toLowerCase();
    const activePositions: StakePosition[] = [];

    for (let index = 0; index < positionIds.length; index += 1) {
      const position = data[index]?.result as PositionResult | undefined;
      if (!position) continue;

      const [
        owner,
        asset,
        tier,
        principal,
        startTime,
        unlockTime,
        lastAccrualTime,
        accruedReward,
        withdrawn,
      ] = position;

      if (withdrawn || owner.toLowerCase() !== connectedAccount) continue;

      activePositions.push({
        id: positionIds[index],
        owner,
        asset,
        tier,
        principal,
        startTime,
        unlockTime,
        lastAccrualTime,
        accruedReward,
        withdrawn,
      });
    }

    return activePositions;
  }, [address, data, positionIds]);

  useEffect(() => {
    if (!refreshDetailsAfterCountRef.current) return;

    refreshDetailsAfterCountRef.current = false;
    if (positionIds.length > 0) void refetchDetails();
  }, [positionIds, refetchDetails]);

  const refetch = useCallback(async () => {
    refreshDetailsAfterCountRef.current = true;
    const refreshedCount = await refetchPositionCount();

    // Withdraw keeps the same ID range, so refresh the existing rows now.
    // A new stake changes nextPositionId; the effect above waits for React to
    // build the new ID range before it fetches details for the new position.
    if (refreshedCount.data === nextPositionId) {
      refreshDetailsAfterCountRef.current = false;
      if (positionIds.length > 0) await refetchDetails();
    }
  }, [nextPositionId, positionIds.length, refetchDetails, refetchPositionCount]);

  return {
    positions,
    isLoading:
      Boolean(address) &&
      (loadingPositionCount || (positionIds.length > 0 && loadingDetails)),
    isError: positionCountError || positionDetailsError,
    dataUpdatedAt: Math.max(positionCountUpdatedAt, positionDetailsUpdatedAt),
    refetch,
  };
}
