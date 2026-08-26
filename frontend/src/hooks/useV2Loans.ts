import { useMemo } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { CONTRACTS, V2_CONTRACTS, lendingPoolV2Abi, oracleAdapterV2Abi } from '../config/contracts';

export type V2Asset = 'USDC' | 'EURC';

export interface V2Loan {
  deployment: 'v2';
  asset: V2Asset;
  principal: bigint;
  storedInterest: bigint;
  pendingInterest: bigint;
  debt: bigint;
  active: boolean;
}

export function useV2Loans(enabled = true) {
  const { address } = useAccount();
  const read = useReadContracts({
    contracts: address && enabled ? [
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'loans' as const, args: [address, CONTRACTS.usdc] as const },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'loans' as const, args: [address, CONTRACTS.eurc] as const },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt' as const, args: [address, CONTRACTS.usdc] as const },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt' as const, args: [address, CONTRACTS.eurc] as const },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'isHealthy' as const, args: [CONTRACTS.usdc] as const },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'isHealthy' as const, args: [CONTRACTS.eurc] as const },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'liquidationThresholdBps' as const },
    ] : [],
    query: { enabled: Boolean(address) && enabled, refetchInterval: 10_000, staleTime: 8_000 },
  });
  const loans = useMemo<V2Loan[]>(() => (['USDC', 'EURC'] as const).map((asset, index) => {
    const loan = read.data?.[index]?.result as [bigint, bigint, bigint, boolean] | undefined;
    const debt = read.data?.[index + 2]?.result as [bigint, bigint, bigint] | undefined;
    const principal = debt?.[0] ?? loan?.[0] ?? 0n;
    const storedInterest = debt?.[1] ?? loan?.[1] ?? 0n;
    const pendingInterest = debt?.[2] ?? 0n;
    return { deployment: 'v2' as const, asset, principal, storedInterest, pendingInterest, debt: principal + storedInterest + pendingInterest, active: loan?.[3] ?? false };
  }).filter((loan) => loan.active || loan.debt > 0n), [read.data]);
  const oracleHealthy = (read.data?.[4]?.result === true) && (read.data?.[5]?.result === true);
  const liquidationThresholdBps = (read.data?.[6]?.result as bigint | undefined) ?? 8_330n;
  return { loans, oracleHealthy, liquidationThresholdBps, isLoading: read.isLoading && read.data === undefined, isError: read.isError, refetch: read.refetch };
}
