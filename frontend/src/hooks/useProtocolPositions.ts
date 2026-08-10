import { useCallback, useMemo } from 'react';
import { useV1Positions, type V1StakePosition } from './useV1Positions';
import { useV2Positions, type V2StakePosition } from './useV2Positions';

export type ProtocolStakePosition = (V1StakePosition & { deployment: 'v1'; key: string }) | V2StakePosition;

export function useProtocolPositions() {
  const v1 = useV1Positions();
  const v2 = useV2Positions();
  const positions = useMemo<ProtocolStakePosition[]>(() => [
    ...v1.positions.map((position) => ({ ...position, deployment: 'v1' as const, key: `v1:${position.id}` })),
    ...v2.positions,
  ], [v1.positions, v2.positions]);
  const refetch = useCallback(async () => { await Promise.all([v1.refetch(), v2.refetch()]); }, [v1, v2]);
  return { positions, isLoading: v1.isLoading || v2.isLoading, isError: v1.isError || v2.isError, refetch };
}
