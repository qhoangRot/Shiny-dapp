import { useCallback, useMemo } from 'react';
import { formatUnits } from 'viem';
import { useReadContracts } from 'wagmi';
import {
  CONTRACTS,
  TESTNET_ORACLE,
  V2_CONTRACTS,
  insuranceFundV2Abi,
  lendingPoolV2Abi,
  oracleAdapterV2Abi,
  stakingVaultV2Abi,
} from '../config/contracts';
import { calculateCreditBreakdown, tierForScore, type CreditTier } from '../lib/creditScore';

const SECONDS_PER_YEAR = 31_536_000;
const RATE_SCALE = 10n ** 18n;

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

type LoanResult = [bigint, bigint, bigint, boolean];

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

function liveDebt(loan: LoanResult | undefined, rate: bigint, now: bigint) {
  if (!loan) return 0n;
  const [principal, lastAccrualTime, accruedInterest, active] = loan;
  if (!active || principal === 0n || now <= lastAccrualTime) {
    return principal + accruedInterest;
  }
  const elapsed = now - lastAccrualTime;
  return principal + accruedInterest + (principal * rate * elapsed) / RATE_SCALE;
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
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'totalPrincipal', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'totalPrincipal', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'lastAcceptedPrice', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'borrowRatePerSecond', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'maxLtvBps' },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'liquidationThresholdBps' },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'liquidationBonusBps' },
      { address: V2_CONTRACTS.insuranceFund, abi: insuranceFundV2Abi, functionName: 'availableInsurance', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.insuranceFund, abi: insuranceFundV2Abi, functionName: 'availableInsurance', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'paused' },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'paused' },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'owner' },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'owner' },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'paused' },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'MAX_PRICE_AGE' },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'owner' },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'nextPositionId' },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'updatedAt', args: [CONTRACTS.eurc] },
      // Lending liquidity is separate from staking principal. This value is
      // reserved for loans after accounting for unsettled protocol revenue.
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'availableLiquidity', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'availableLiquidity', args: [CONTRACTS.eurc] },
    ],
    query: {
      staleTime: 5_000,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      retry: 2,
    },
  });

  const nextPositionId = (data?.[17]?.result as bigint | undefined) ?? 1n;
  const positionIds = useMemo(
    () => nextPositionId > 1n
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
      address: V2_CONTRACTS.stakingVault,
      abi: stakingVaultV2Abi,
      functionName: 'positions',
      args: [id],
    })),
    query: {
      enabled: positionIds.length > 0,
      staleTime: 5_000,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
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

  const activePositions = useMemo(
    () => positions.filter((position) => !position.withdrawn),
    [positions],
  );
  const trackedAccounts = useMemo(
    () => [...new Set(activePositions.map((position) => position.owner.toLowerCase()))] as `0x${string}`[],
    [activePositions],
  );

  const {
    data: loanData,
    isLoading: loansLoading,
    isError: loansError,
    isFetching: loansFetching,
    dataUpdatedAt: loansUpdatedAt,
    refetch: refetchLoans,
  } = useReadContracts({
    contracts: trackedAccounts.flatMap((account) => ([
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'loans' as const, args: [account, CONTRACTS.usdc] as const },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'loans' as const, args: [account, CONTRACTS.eurc] as const },
    ])),
    query: {
      enabled: trackedAccounts.length > 0,
      staleTime: 5_000,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      retry: 2,
    },
  });

  const {
    data: rewardData,
    isLoading: rewardsLoading,
    isError: rewardsError,
    isFetching: rewardsFetching,
    dataUpdatedAt: rewardsUpdatedAt,
    refetch: refetchRewards,
  } = useReadContracts({
    contracts: [
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'rewardReserve', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'rewardReserve', args: [CONTRACTS.eurc] },
      { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'owner' },
    ],
    query: {
      enabled: true,
      staleTime: 5_000,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      retry: 2,
    },
  });

  const analytics = useMemo(() => {
    const result = <T,>(index: number, fallback: T) =>
      (data?.[index]?.result as T | undefined) ?? fallback;
    const eurUsdPrice = Number(formatUnits(result(2, BigInt(Math.round(TESTNET_ORACLE.initialPrice * 1e18))), 18));
    const poolUsdcAvailable = tokenAmount(result(19, 0n));
    const poolEurcAvailable = tokenAmount(result(20, 0n));
    const usdcRate = result(3, 0n);
    const eurcRate = result(4, 0n);
    const now = BigInt(Math.floor(Date.now() / 1_000));

    let borrowedUsdcWei = 0n;
    let borrowedEurcWei = 0n;
    let activeLoans = 0;
    const borrowers = new Set<string>();
    trackedAccounts.forEach((account, accountIndex) => {
      const usdcLoan = loanData?.[accountIndex * 2]?.result as LoanResult | undefined;
      const eurcLoan = loanData?.[accountIndex * 2 + 1]?.result as LoanResult | undefined;
      const usdcDebt = liveDebt(usdcLoan, usdcRate, now);
      const eurcDebt = liveDebt(eurcLoan, eurcRate, now);
      borrowedUsdcWei += usdcDebt;
      borrowedEurcWei += eurcDebt;
      if (usdcDebt > 0n) activeLoans += 1;
      if (eurcDebt > 0n) activeLoans += 1;
      if (usdcDebt > 0n || eurcDebt > 0n) borrowers.add(account);
    });

    const stakedUsdc = activePositions
      .filter((position) => position.asset.toLowerCase() === CONTRACTS.usdc.toLowerCase())
      .reduce((sum, position) => sum + tokenAmount(position.principal), 0);
    const stakedEurc = activePositions
      .filter((position) => position.asset.toLowerCase() === CONTRACTS.eurc.toLowerCase())
      .reduce((sum, position) => sum + tokenAmount(position.principal), 0);
    const borrowedUsdc = tokenAmount(borrowedUsdcWei);
    const borrowedEurc = tokenAmount(borrowedEurcWei);
    const usdcPoolSupply = poolUsdcAvailable + borrowedUsdc;
    const eurcPoolSupply = poolEurcAvailable + borrowedEurc;
    const totalBorrowedUsd = borrowedUsdc + borrowedEurc * eurUsdPrice;
    const lendingSupplyUsd = usdcPoolSupply + eurcPoolSupply * eurUsdPrice;
    const stakedUsd = stakedUsdc + stakedEurc * eurUsdPrice;
    const totalTvlUsd = stakedUsd + lendingSupplyUsd;
    const utilization = lendingSupplyUsd > 0 ? (totalBorrowedUsd / lendingSupplyUsd) * 100 : 0;
    const usdcUtilization = usdcPoolSupply > 0 ? (borrowedUsdc / usdcPoolSupply) * 100 : 0;
    const eurcUtilization = eurcPoolSupply > 0 ? (borrowedEurc / eurcPoolSupply) * 100 : 0;
    const usdcBorrowApr = rateToApr(usdcRate);
    const eurcBorrowApr = rateToApr(eurcRate);
    const projectedInterest30d =
      (borrowedUsdc * usdcBorrowApr) / 100 / 12
      + (borrowedEurc * eurUsdPrice * eurcBorrowApr) / 100 / 12;
    const insuranceUsdc = tokenAmount(result(8, 0n));
    const insuranceEurc = tokenAmount(result(9, 0n));
    const insuranceUsd = insuranceUsdc + insuranceEurc * eurUsdPrice;
    const rewardReserveUsdc = tokenAmount(rewardData?.[0]?.result as bigint | undefined);
    const rewardReserveEurc = tokenAmount(rewardData?.[1]?.result as bigint | undefined);
    const rewardReserveUsd = rewardReserveUsdc + rewardReserveEurc * eurUsdPrice;

    const users = new Map<string, ProtocolPosition[]>();
    activePositions.forEach((position) => {
      const key = position.owner.toLowerCase();
      users.set(key, [...(users.get(key) ?? []), position]);
    });
    const distribution: Record<CreditTier, number> = { Bronze: 0, Silver: 0, Gold: 0, Diamond: 0 };
    users.forEach((userPositions) => {
      distribution[tierForScore(calculateCreditBreakdown(userPositions, eurUsdPrice).total)] += 1;
    });
    const tierPositions = [0, 1, 2].map(
      (tier) => activePositions.filter((position) => position.tier === tier).length,
    );

    return {
      activePositions,
      activeLoans,
      borrowerCount: borrowers.size,
      trackedAccountCount: trackedAccounts.length,
      eurUsdPrice,
      oracleUpdatedAt: Number(result(18, 0n)) * 1_000,
      stakedUsdc,
      stakedEurc,
      stakedUsd,
      poolUsdcAvailable,
      poolEurcAvailable,
      usdcPoolSupply,
      eurcPoolSupply,
      borrowedUsdc,
      borrowedEurc,
      totalBorrowedUsd,
      lendingSupplyUsd,
      totalTvlUsd,
      utilization,
      usdcUtilization,
      eurcUtilization,
      projectedInterest30d,
      insuranceUsdc,
      insuranceEurc,
      insuranceUsd,
      rewardReserveUsdc,
      rewardReserveEurc,
      rewardReserveUsd,
      rewardDistributorConfigured: true,
      rewardDistributorOwner: shortAddress(rewardData?.[2]?.result as string | undefined),
      usdcBorrowApr,
      eurcBorrowApr,
      maxLtv: Number(result(5, 0n)) / 100,
      liquidationThreshold: Number(result(6, 0n)) / 100,
      liquidationBonus: Number(result(7, 0n)) / 100,
      lendingPaused: result(10, false),
      vaultPaused: result(11, false),
      lendingOwner: shortAddress(result(12, '' as string)),
      vaultOwner: shortAddress(result(13, '' as string)),
      oraclePaused: result(14, false),
      oracleMaxStaleness: Number(result(15, 0n)),
      oracleOwner: shortAddress(result(16, '' as string)),
      distribution,
      userCount: users.size,
      tierPositions,
    };
  }, [activePositions, data, loanData, rewardData, trackedAccounts]);

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchOverview(),
      positionIds.length > 0 ? refetchPositions() : Promise.resolve(),
      trackedAccounts.length > 0 ? refetchLoans() : Promise.resolve(),
      refetchRewards(),
    ]);
  }, [positionIds.length, refetchLoans, refetchOverview, refetchPositions, refetchRewards, trackedAccounts.length]);

  return {
    ...analytics,
    isLoading:
      isLoading
      || (positionIds.length > 0 && positionsLoading)
      || (trackedAccounts.length > 0 && loansLoading)
      || rewardsLoading,
    isError: isError || positionsError || loansError || rewardsError,
    isFetching: isFetching || positionsFetching || loansFetching || rewardsFetching,
    dataUpdatedAt: Math.max(dataUpdatedAt, positionsUpdatedAt, loansUpdatedAt, rewardsUpdatedAt),
    refetch,
  };
}
