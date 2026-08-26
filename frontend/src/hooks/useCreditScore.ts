import { useCallback, useMemo } from 'react';
import { formatUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, TESTNET_ORACLE, V2_CONTRACTS, oracleAdapterV2Abi } from '../config/contracts';
import {
  benefitsForTier,
  buildCreditChanges,
  buildCreditHistory,
  calculateCreditBreakdown,
  tierForScore,
} from '../lib/creditScore';
import { useV2Positions } from './useV2Positions';

export function useCreditScore() {
  const { address } = useAccount();
  const {
    positions,
    isLoading: positionsLoading,
    isError: positionsError,
    refetch: refetchPositions,
  } = useV2Positions();

  const {
    data: oracleData,
    isLoading: oracleLoading,
    isError: oracleError,
    isFetching,
    dataUpdatedAt: oracleUpdatedAt,
    refetch: refetchOracle,
  } = useReadContract({
    address: V2_CONTRACTS.oracleAdapter,
    abi: oracleAdapterV2Abi,
    functionName: 'lastAcceptedPrice',
    args: [CONTRACTS.eurc],
    query: {
      enabled: Boolean(address),
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: 2,
    },
  });

  const eurUsdPrice = oracleData
    ? Number(formatUnits(oracleData, 18))
    : TESTNET_ORACLE.initialPrice;

  const model = useMemo(() => {
    const breakdown = calculateCreditBreakdown(positions, eurUsdPrice);
    const tier = tierForScore(breakdown.total);
    return {
      breakdown,
      tier,
      benefits: benefitsForTier(tier),
      changes: buildCreditChanges(positions),
      history: buildCreditHistory(positions, breakdown.total),
    };
  }, [eurUsdPrice, positions]);

  const refetch = useCallback(async () => {
    await Promise.all([refetchPositions(), refetchOracle()]);
  }, [refetchOracle, refetchPositions]);

  return {
    ...model,
    isLoading: positionsLoading || oracleLoading,
    isError: positionsError || oracleError,
    isFetching,
    dataUpdatedAt: oracleUpdatedAt,
    oracleTimestamp: 0,
    refetch,
  };
}
