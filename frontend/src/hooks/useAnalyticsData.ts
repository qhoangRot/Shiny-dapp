import { useCallback, useMemo } from 'react';
import { formatUnits } from 'viem';
import { useReadContracts } from 'wagmi';
import {
  CONTRACTS,
  TESTNET_LIQUIDITY_SEED,
  TESTNET_ORACLE,
  erc20Abi,
  lendingPoolAbi,
  priceOracleAbi,
  stakingVaultAbi,
} from '../config/contracts';
import { calculateCreditBreakdown, tierForScore, type CreditTier } from '../lib/creditScore';

const SECONDS_PER_YEAR = 31_536_000;

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

export interface ProtocolPosition {
  id: bigint;
  owner: `0x${string}`;
  asset: `0x${string}`;
  tier: number;
  principal: bigint;
  startTime: bigint;
  withdrawn: boolean;
}

function tokenAmount(value: bigint | undefined) {
  return Number(formatUnits(value ?? 0n, 6));
}

function rateToApr(value: bigint | undefined) {
  return Number(formatUnits(value ?? 0n, 18)) * SECONDS_PER_YEAR * 100;
}

function shortAddress(address: string | undefined) {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useAnalyticsData() {
  const {
    data,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch: refetchOverview,
  } = useReadContracts({
    contracts: [
      { address: CONTRACTS.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.lendingPool] },
      { address: CONTRACTS.eurc, abi: erc20Abi, functionName: 'balanceOf', args: [CONTRACTS.lendingPool] },
      { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'viewPrice' },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'rewardRatePerSecond', args: [CONTRACTS.usdc] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'rewardRatePerSecond', args: [CONTRACTS.eurc] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.usdc] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.eurc] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'maxLtvBps' },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'liquidationThresholdBps' },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'pendingInsuranceFund', args: [CONTRACTS.usdc] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'pendingInsuranceFund', args: [CONTRACTS.eurc] },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'paused' },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'paused' },
      { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'owner' },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'owner' },
      { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'paused' },
      { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'maxStaleness' },
      { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'owner' },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'nextPositionId' },
    ],
    query: {
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: 2,
    },
  });

  const nextPositionId = (data?.[18]?.result as bigint | undefined) ?? 1n;
  const positionIds = useMemo(
    () =>
      nextPositionId > 1n
        ? Array.from({ length: Number(nextPositionId - 1n) }, (_, index) => BigInt(index + 1))
        : [],
    [nextPositionId],
  );

  const {
    data: positionData,
    isLoading: positionsLoading,
    isError: positionsError,
    isFetching: positionsFetching,
    dataUpdatedAt: positionsUpdatedAt,
    refetch: refetchPositions,
  } = useReadContracts({
    contracts: positionIds.map((id) => ({
      address: CONTRACTS.stakingVault,
      abi: stakingVaultAbi,
      functionName: 'positions',
      args: [id],
    })),
    query: {
      enabled: positionIds.length > 0,
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: 2,
    },
  });

  const positions = useMemo<ProtocolPosition[]>(() => {
    if (!positionData) return [];
    return positionIds.flatMap((id, index) => {
      const position = positionData[index]?.result as PositionResult | undefined;
      if (!position) return [];
      return [{
        id,
        owner: position[0],
        asset: position[1],
        tier: position[2],
        principal: position[3],
        startTime: position[4],
        withdrawn: position[8],
      }];
    });
  }, [positionData, positionIds]);

  const analytics = useMemo(() => {
    const result = <T,>(index: number, fallback: T) =>
      (data?.[index]?.result as T | undefined) ?? fallback;
    const activePositions = positions.filter((position) => !position.withdrawn);
    const eurUsdPriceTuple = result(2, [BigInt(Math.round(TESTNET_ORACLE.initialPrice * 1e18)), 0n] as [bigint, bigint]);
    const eurUsdPrice = Number(formatUnits(eurUsdPriceTuple[0], 18));
    const poolUsdcAvailable = tokenAmount(result(0, 0n));
    const poolEurcAvailable = tokenAmount(result(1, 0n));
    const stakedUsdc = activePositions
      .filter((position) => position.asset.toLowerCase() === CONTRACTS.usdc.toLowerCase())
      .reduce((sum, position) => sum + tokenAmount(position.principal), 0);
    const stakedEurc = activePositions
      .filter((position) => position.asset.toLowerCase() === CONTRACTS.eurc.toLowerCase())
      .reduce((sum, position) => sum + tokenAmount(position.principal), 0);
    const borrowedUsdc = Math.max(0, TESTNET_LIQUIDITY_SEED.USDC - poolUsdcAvailable);
    const borrowedEurc = Math.max(0, TESTNET_LIQUIDITY_SEED.EURC - poolEurcAvailable);
    const totalBorrowedUsd = borrowedUsdc + borrowedEurc * eurUsdPrice;
    const lendingSupplyUsd =
      TESTNET_LIQUIDITY_SEED.USDC + TESTNET_LIQUIDITY_SEED.EURC * eurUsdPrice;
    const totalTvlUsd = stakedUsdc + stakedEurc * eurUsdPrice + lendingSupplyUsd;
    const utilization = lendingSupplyUsd > 0 ? (totalBorrowedUsd / lendingSupplyUsd) * 100 : 0;
    const usdcBorrowApr = rateToApr(result(5, 0n));
    const eurcBorrowApr = rateToApr(result(6, 0n));
    const revenue30d =
      (borrowedUsdc * usdcBorrowApr) / 100 / 12 +
      (borrowedEurc * eurUsdPrice * eurcBorrowApr) / 100 / 12;
    const insuranceUsdc = tokenAmount(result(9, 0n));
    const insuranceEurc = tokenAmount(result(10, 0n));
    const insuranceUsd = insuranceUsdc + insuranceEurc * eurUsdPrice;

    const users = new Map<string, ProtocolPosition[]>();
    activePositions.forEach((position) => {
      const key = position.owner.toLowerCase();
      users.set(key, [...(users.get(key) ?? []), position]);
    });
    const distribution: Record<CreditTier, number> = {
      Bronze: 0,
      Silver: 0,
      Gold: 0,
      Diamond: 0,
    };
    users.forEach((userPositions) => {
      const score = calculateCreditBreakdown(userPositions, eurUsdPrice).total;
      distribution[tierForScore(score)] += 1;
    });

    const now = new Date();
    const history = Array.from({ length: 90 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (89 - index));
      date.setHours(23, 59, 59, 999);
      const cutoff = date.getTime() / 1000;
      const historicalPositions = activePositions.filter(
        (position) => Number(position.startTime) <= cutoff,
      );
      const historicalUsdc = historicalPositions
        .filter((position) => position.asset.toLowerCase() === CONTRACTS.usdc.toLowerCase())
        .reduce((sum, position) => sum + tokenAmount(position.principal), 0);
      const historicalEurc = historicalPositions
        .filter((position) => position.asset.toLowerCase() === CONTRACTS.eurc.toLowerCase())
        .reduce((sum, position) => sum + tokenAmount(position.principal), 0);
      const borrowRamp = index < 60 ? 0 : (index - 59) / 30;
      return {
        date,
        tvl: historicalUsdc + historicalEurc * eurUsdPrice + lendingSupplyUsd,
        supply: historicalUsdc + historicalEurc * eurUsdPrice + lendingSupplyUsd,
        borrowed: totalBorrowedUsd * borrowRamp,
      };
    });

    return {
      activePositions,
      eurUsdPrice,
      oracleUpdatedAt: Number(eurUsdPriceTuple[1]) * 1000,
      stakedUsdc,
      stakedEurc,
      poolUsdcAvailable,
      poolEurcAvailable,
      borrowedUsdc,
      borrowedEurc,
      totalBorrowedUsd,
      totalTvlUsd,
      utilization,
      revenue30d,
      insuranceUsdc,
      insuranceEurc,
      insuranceUsd,
      usdcStakeApr: rateToApr(result(3, 0n)),
      eurcStakeApr: rateToApr(result(4, 0n)),
      usdcBorrowApr,
      eurcBorrowApr,
      maxLtv: Number(result(7, 0n)) / 100,
      liquidationThreshold: Number(result(8, 0n)) / 100,
      lendingPaused: result(11, false),
      vaultPaused: result(12, false),
      lendingOwner: shortAddress(result(13, '' as string)),
      vaultOwner: shortAddress(result(14, '' as string)),
      oraclePaused: result(15, false),
      oracleMaxStaleness: Number(result(16, 0n)),
      oracleOwner: shortAddress(result(17, '' as string)),
      distribution,
      userCount: users.size,
      history,
    };
  }, [data, positions]);

  const refetch = useCallback(async () => {
    await refetchOverview();
    if (positionIds.length > 0) await refetchPositions();
  }, [positionIds.length, refetchOverview, refetchPositions]);

  return {
    ...analytics,
    isLoading: isLoading || (positionIds.length > 0 && positionsLoading),
    isError: isError || positionsError,
    isFetching: isFetching || positionsFetching,
    dataUpdatedAt: Math.max(dataUpdatedAt, positionsUpdatedAt),
    refetch,
  };
}
