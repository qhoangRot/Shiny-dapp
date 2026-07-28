import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseError, maxUint256 } from 'viem';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import {
  CONTRACTS,
  erc20Abi,
  lendingPoolAbi,
  priceOracleAbi,
} from '../config/contracts';
import { useRefreshProtocolData } from './useRefreshProtocolData';

export type RepayAsset = 'USDC' | 'EURC';

const RATE_SCALE = 10n ** 18n;
const MAX_HF_THRESHOLD = 1e20;

type LoanTuple = readonly [bigint, bigint, bigint, boolean];

export interface RepaySnapshot {
  balance: bigint;
  allowance: bigint;
  principal: bigint;
  accruedInterest: bigint;
  liveInterest: bigint;
  currentDebt: bigint;
  lastAccrualTime: bigint;
  ratePerSecond: bigint;
  usdcStoredDebt: bigint;
  eurcStoredDebt: bigint;
  usdcLiveDebt: bigint;
  eurcLiveDebt: bigint;
  rawHealthFactor: number;
  eurcUsdPrice: number;
}

interface UseRepayOptions {
  open: boolean;
  asset: RepayAsset;
  amount: bigint;
  fullRepay: boolean;
  onTransactionConfirmed?: () => void | Promise<void>;
}

function liveDebt(
  loan: LoanTuple | undefined,
  ratePerSecond: bigint,
  nowSeconds: bigint,
) {
  if (!loan) {
    return {
      principal: 0n,
      lastAccrualTime: 0n,
      accruedInterest: 0n,
      liveInterest: 0n,
      debt: 0n,
    };
  }

  const [principal, lastAccrualTime, accruedInterest] = loan;
  const elapsed = nowSeconds > lastAccrualTime
    ? nowSeconds - lastAccrualTime
    : 0n;
  const pendingInterest = principal > 0n && ratePerSecond > 0n
    ? (principal * ratePerSecond * elapsed) / RATE_SCALE
    : 0n;
  const liveInterest = accruedInterest + pendingInterest;

  return {
    principal,
    lastAccrualTime,
    accruedInterest,
    liveInterest,
    debt: principal + liveInterest,
  };
}

function messageFromError(error: unknown) {
  const message = error instanceof BaseError
    ? error.shortMessage
    : error instanceof Error
      ? error.message
      : 'The transaction could not be prepared.';

  if (/user rejected|user denied/i.test(message)) {
    return 'Transaction cancelled in your wallet.';
  }
  if (/Khong co no can tra/i.test(message)) {
    return 'No active debt to repay.';
  }
  if (/allowance|transfer amount exceeds allowance/i.test(message)) {
    return 'The token allowance is too low. Approve the repayment amount first.';
  }
  if (/balance|transfer amount exceeds balance/i.test(message)) {
    return 'Your wallet balance is too low for this repayment.';
  }

  return message;
}

export function useRepay({
  open,
  asset,
  amount,
  fullRepay,
  onTransactionConfirmed,
}: UseRepayOptions) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const refreshProtocolData = useRefreshProtocolData();
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const [clockAnchor, setClockAnchor] = useState<{
    chainTimestamp: bigint;
    observedAt: number;
  } | null>(null);
  const [preparing, setPreparing] = useState<'approve' | 'repay' | 'sync' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [verifiedAllowance, setVerifiedAllowance] = useState<bigint | null>(null);
  const syncedApproveHash = useRef<`0x${string}` | undefined>(undefined);
  const syncedRepayHash = useRef<`0x${string}` | undefined>(undefined);

  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;

  const {
    data,
    error: readError,
    isLoading: readsLoading,
    isFetching: readsFetching,
    refetch,
  } = useReadContracts({
    contracts: address
      ? [
          {
            address: assetAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          },
          {
            address: assetAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, CONTRACTS.lendingPool],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'loans',
            args: [address, assetAddress],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'borrowRatePerSecond',
            args: [assetAddress],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'loans',
            args: [address, CONTRACTS.usdc],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'loans',
            args: [address, CONTRACTS.eurc],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'borrowRatePerSecond',
            args: [CONTRACTS.usdc],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'borrowRatePerSecond',
            args: [CONTRACTS.eurc],
          },
          {
            address: CONTRACTS.lendingPool,
            abi: lendingPoolAbi,
            functionName: 'getHealthFactor',
            args: [address],
          },
          {
            address: CONTRACTS.priceOracle,
            abi: priceOracleAbi,
            functionName: 'viewPrice',
          },
        ]
      : [],
    query: {
      enabled: !!address && open,
      refetchInterval: open ? 15_000 : false,
    },
  });

  const approveWrite = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveWrite.data });
  const repayWrite = useWriteContract();
  const repayReceipt = useWaitForTransactionReceipt({ hash: repayWrite.data });

  useEffect(() => {
    if (!open || !publicClient) return;

    let cancelled = false;
    const syncChainClock = async () => {
      try {
        const block = await publicClient.getBlock({ blockTag: 'latest' });
        if (!cancelled) {
          setClockAnchor({
            chainTimestamp: block.timestamp,
            observedAt: Date.now(),
          });
        }
      } catch {
        // Preserve the previous chain anchor through a transient RPC failure.
      }
    };

    void syncChainClock();
    const syncTimer = window.setInterval(() => {
      void syncChainClock();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
    };
  }, [address, asset, chainId, open, publicClient]);

  useEffect(() => {
    if (!open) return;

    const updateClock = () => {
      if (!clockAnchor) {
        setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
        return;
      }

      const elapsed = BigInt(Math.max(
        0,
        Math.floor((Date.now() - clockAnchor.observedAt) / 1_000),
      ));
      setNowSeconds(clockAnchor.chainTimestamp + elapsed);
    };

    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, [clockAnchor, open]);

  useEffect(() => {
    setLocalError(null);
    setPreparing(null);
    syncedApproveHash.current = undefined;
    syncedRepayHash.current = undefined;
    setVerifiedAllowance(null);
    setClockAnchor(null);
    approveWrite.reset();
    repayWrite.reset();
    // Reset only when a new drawer session/asset starts. Transaction objects
    // themselves are deliberately excluded because their identities can change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, asset, chainId, open]);

  const snapshot = useMemo<RepaySnapshot | null>(() => {
    const balance = data?.[0]?.result as bigint | undefined;
    const allowance = data?.[1]?.result as bigint | undefined;
    const selectedLoan = data?.[2]?.result as LoanTuple | undefined;
    const selectedRate = data?.[3]?.result as bigint | undefined;
    const usdcLoan = data?.[4]?.result as LoanTuple | undefined;
    const eurcLoan = data?.[5]?.result as LoanTuple | undefined;
    const usdcRate = data?.[6]?.result as bigint | undefined;
    const eurcRate = data?.[7]?.result as bigint | undefined;

    if (
      balance === undefined
      || allowance === undefined
      || !selectedLoan
      || selectedRate === undefined
      || !usdcLoan
      || !eurcLoan
      || usdcRate === undefined
      || eurcRate === undefined
    ) {
      return null;
    }

    const selected = liveDebt(selectedLoan, selectedRate, nowSeconds);
    const usdc = liveDebt(usdcLoan, usdcRate, nowSeconds);
    const eurc = liveDebt(eurcLoan, eurcRate, nowSeconds);
    const rawHf = data?.[8]?.result as bigint | undefined;
    const oracle = data?.[9]?.result as readonly [bigint, bigint] | undefined;
    const numericHf = rawHf === undefined
      ? Number.NaN
      : Number(rawHf) / 1e18;

    return {
      balance,
      allowance,
      principal: selected.principal,
      accruedInterest: selected.accruedInterest,
      liveInterest: selected.liveInterest,
      currentDebt: selected.debt,
      lastAccrualTime: selected.lastAccrualTime,
      ratePerSecond: selectedRate,
      usdcStoredDebt: usdc.principal + usdc.accruedInterest,
      eurcStoredDebt: eurc.principal + eurc.accruedInterest,
      usdcLiveDebt: usdc.debt,
      eurcLiveDebt: eurc.debt,
      rawHealthFactor: numericHf > MAX_HF_THRESHOLD
        ? Number.POSITIVE_INFINITY
        : numericHf,
      eurcUsdPrice: oracle && oracle[0] > 0n
        ? Number(oracle[0]) / 1e18
        : 0,
    };
  }, [data, nowSeconds]);

  // The contract caps maxUint256 to the exact amount owed. Using the same
  // sentinel for approval makes a full repayment atomic: it either closes the
  // selected loan completely or reverts instead of silently leaving dust.
  const approvalAmount = fullRepay ? maxUint256 : amount;
  const transactionAmount = fullRepay ? maxUint256 : amount;
  const effectiveAllowance = snapshot
    ? verifiedAllowance !== null && verifiedAllowance > snapshot.allowance
      ? verifiedAllowance
      : snapshot.allowance
    : 0n;
  const needsApproval = !!snapshot
    && amount > 0n
    && effectiveAllowance < approvalAmount;

  const refresh = useCallback(async () => {
    await Promise.all([
      refreshProtocolData(),
      refetch(),
    ]);
  }, [refetch, refreshProtocolData]);

  const clearError = useCallback(() => {
    setLocalError(null);
    approveWrite.reset();
    repayWrite.reset();
    syncedApproveHash.current = undefined;
    syncedRepayHash.current = undefined;
  }, [approveWrite, repayWrite]);

  useEffect(() => {
    const hash = approveWrite.data;
    if (!approveReceipt.isSuccess || !hash || syncedApproveHash.current === hash) return;

    syncedApproveHash.current = hash;
    setPreparing('sync');
    void (async () => {
      const receiptBlock = approveReceipt.data?.blockNumber;
      if (address && publicClient && receiptBlock !== undefined) {
        try {
          const confirmedAllowance = await publicClient.readContract({
            address: assetAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, CONTRACTS.lendingPool],
            blockNumber: receiptBlock,
          });
          setVerifiedAllowance(confirmedAllowance);
        } catch {
          // The normal query refresh below remains the fallback for RPCs that
          // do not support a block-pinned eth_call.
        }
      }
      await refresh();
      // Arc RPC can briefly trail the receipt block. Keep the flow in a
      // verification state and confirm allowance once more before enabling Repay.
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 700);
      });
      await refetch();
    })()
      .catch((error: unknown) => setLocalError(messageFromError(error)))
      .finally(() => setPreparing(null));
  }, [
    address,
    approveReceipt.data?.blockNumber,
    approveReceipt.isSuccess,
    approveWrite.data,
    assetAddress,
    publicClient,
    refetch,
    refresh,
  ]);

  useEffect(() => {
    const hash = repayWrite.data;
    if (!repayReceipt.isSuccess || !hash || syncedRepayHash.current === hash) return;

    syncedRepayHash.current = hash;
    setPreparing('sync');
    void Promise.all([
      refresh(),
      Promise.resolve(onTransactionConfirmed?.()),
    ])
      .catch(() => undefined)
      .finally(() => setPreparing(null));
  }, [
    onTransactionConfirmed,
    refresh,
    repayReceipt.isSuccess,
    repayWrite.data,
  ]);

  const approve = useCallback(async () => {
    if (!address || !publicClient || approvalAmount === 0n) return;

    setLocalError(null);
    setPreparing('approve');
    try {
      const { request } = await publicClient.simulateContract({
        account: address,
        address: assetAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [CONTRACTS.lendingPool, approvalAmount],
      });
      await approveWrite.writeContractAsync(request);
    } catch (error) {
      setLocalError(messageFromError(error));
    } finally {
      setPreparing(null);
    }
  }, [
    address,
    approvalAmount,
    approveWrite,
    assetAddress,
    publicClient,
  ]);

  const repay = useCallback(async () => {
    if (!address || !publicClient || transactionAmount === 0n || needsApproval) return;

    setLocalError(null);
    setPreparing('repay');
    try {
      const { request } = await publicClient.simulateContract({
        account: address,
        address: CONTRACTS.lendingPool,
        abi: lendingPoolAbi,
        functionName: 'repay',
        args: [assetAddress, transactionAmount],
      });
      await repayWrite.writeContractAsync(request);
    } catch (error) {
      setLocalError(messageFromError(error));
    } finally {
      setPreparing(null);
    }
  }, [
    address,
    assetAddress,
    needsApproval,
    publicClient,
    repayWrite,
    transactionAmount,
  ]);

  const error = localError
    ?? (approveWrite.error ? messageFromError(approveWrite.error) : null)
    ?? (approveReceipt.error ? messageFromError(approveReceipt.error) : null)
    ?? (repayWrite.error ? messageFromError(repayWrite.error) : null)
    ?? (repayReceipt.error ? messageFromError(repayReceipt.error) : null)
    ?? (readError ? messageFromError(readError) : null);

  return {
    snapshot,
    readsLoading,
    readsFetching,
    needsApproval,
    approvalAmount,
    approve,
    repay,
    refresh,
    clearError,
    error,
    preparing,
    approveWalletPending: approveWrite.isPending,
    approving: approveReceipt.isLoading,
    approvalConfirmed: approveReceipt.isSuccess,
    repayWalletPending: repayWrite.isPending,
    repaying: repayReceipt.isLoading,
    repaySuccess: repayReceipt.isSuccess,
    isBusy:
      preparing !== null
      || approveWrite.isPending
      || approveReceipt.isLoading
      || repayWrite.isPending
      || repayReceipt.isLoading,
  };
}
