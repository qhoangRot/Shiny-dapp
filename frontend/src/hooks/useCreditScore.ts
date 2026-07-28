import { useCallback, useMemo } from 'react';
import { formatUnits } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, TESTNET_ORACLE, priceOracleAbi } from '../config/contracts';
import {
  benefitsForTier,
  buildCreditChanges,
  buildCreditHistory,
  calculateCreditBreakdown,
  tierForScore,
} from '../lib/creditScore';
import { usePositions } from './usePositions';

export function useCreditScore() {
  const { address } = useAccount();
  const {
    positions,
    isLoading: positionsLoading,
    isError: positionsError,
    dataUpdatedAt: positionsUpdatedAt,
    refetch: refetchPositions,
  } = usePositions();

  const {
    data: oracleData,
    isLoading: oracleLoading,
    isError: oracleError,
    isFetching,
    dataUpdatedAt: oracleUpdatedAt,
    refetch: refetchOracle,
  } = useReadContract({
    address: CONTRACTS.priceOracle,
    abi: priceOracleAbi,
    functionName: 'viewPrice',
    query: {
      enabled: Boolean(address),
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: 2,
    },
  });

  const eurUsdPrice = oracleData?.[0]
    ? Number(formatUnits(oracleData[0], 18))
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
    dataUpdatedAt: Math.max(positionsUpdatedAt, oracleUpdatedAt),
    oracleTimestamp: oracleData?.[1] ? Number(oracleData[1]) * 1000 : 0,
    refetch,
  };
}
