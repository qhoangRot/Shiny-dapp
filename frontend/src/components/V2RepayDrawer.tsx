import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BaseError, formatUnits, maxUint256, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { CONTRACTS, erc20Abi, lendingPoolV2Abi, oracleAdapterV2Abi, TESTNET_ORACLE, V2_CONTRACTS } from '../config/contracts';
import { InfoTip } from './InfoTip';
import { TokenIcon } from './TokenIcon';

const SECONDS_PER_YEAR = 31_536_000;

function formatApr(ratePerSecond: bigint) {
  const rate = Number(formatUnits(ratePerSecond, 18)) * SECONDS_PER_YEAR * 100;
  return Number.isFinite(rate) ? `${rate.toFixed(2)}%` : '--';
}

function formatToken(value: bigint, digits = 4) {
  return Number(formatUnits(value, 6)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

function shortDate(timestamp: bigint) {
  if (timestamp === 0n) return '--';
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(Number(timestamp) * 1_000));
}

function hfColor(value: number) {
  if (!Number.isFinite(value)) return '#4FD1C5';
  if (value >= 1.5) return '#4FD1C5';
  if (value >= 1.1) return '#E8B54C';
  return '#E5484D';
}

function hfLabel(value: number) {
  if (value === Number.POSITIVE_INFINITY) return 'No Active Loans';
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

export function V2RepayDrawer({ open, asset, onClose, onTransactionConfirmed }: {
  open: boolean;
  asset: 'USDC' | 'EURC';
  onClose: () => void;
  onTransactionConfirmed: () => void | Promise<void>;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [amount, setAmount] = useState('');
  const [fullRepayment, setFullRepayment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const { data, refetch } = useReadContracts({
    contracts: address && open ? [
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt', args: [address, assetAddress] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'loans', args: [address, assetAddress] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'borrowRatePerSecond', args: [assetAddress] },
      { address: assetAddress, abi: erc20Abi, functionName: 'allowance', args: [address, V2_CONTRACTS.lendingPool] },
      { address: assetAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
      { address: V2_CONTRACTS.stakingVault, abi: [{ type: 'function', name: 'getTotalSeizablePrincipal', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'asset', type: 'address' }], outputs: [{ name: 'total', type: 'uint256' }] }] as const, functionName: 'getTotalSeizablePrincipal', args: [address, CONTRACTS.usdc] },
      { address: V2_CONTRACTS.stakingVault, abi: [{ type: 'function', name: 'getTotalSeizablePrincipal', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'asset', type: 'address' }], outputs: [{ name: 'total', type: 'uint256' }] }] as const, functionName: 'getTotalSeizablePrincipal', args: [address, CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt', args: [address, CONTRACTS.usdc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt', args: [address, CONTRACTS.eurc] },
      { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'liquidationThresholdBps' },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'isHealthy', args: [CONTRACTS.usdc] },
      { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'isHealthy', args: [CONTRACTS.eurc] },
    ] : [], query: { enabled: Boolean(address) && open },
  });
  const debtParts = data?.[0]?.result as [bigint, bigint, bigint] | undefined;
  const debt = (debtParts?.[0] ?? 0n) + (debtParts?.[1] ?? 0n) + (debtParts?.[2] ?? 0n);
  const loan = data?.[1]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const borrowRatePerSecond = data?.[2]?.result as bigint | undefined ?? 0n;
  const allowance = data?.[3]?.result as bigint | undefined ?? 0n;
  const balance = data?.[4]?.result as bigint | undefined ?? 0n;
  const v2CollateralUsdc = data?.[5]?.result as bigint | undefined ?? 0n;
  const v2CollateralEurc = data?.[6]?.result as bigint | undefined ?? 0n;
  const usdcDebtParts = data?.[7]?.result as [bigint, bigint, bigint] | undefined;
  const eurcDebtParts = data?.[8]?.result as [bigint, bigint, bigint] | undefined;
  const liquidationThresholdBps = data?.[9]?.result as bigint | undefined ?? 8_330n;
  const oracleHealthy = data?.[10]?.result === true && data?.[11]?.result === true;
  const requested = useMemo(() => { try { return amount ? parseUnits(amount, 6) : 0n; } catch { return 0n; } }, [amount]);
  const repayAmount = fullRepayment ? maxUint256 : requested;
  const displayRepayAmount = fullRepayment ? debt : requested;
  const hasRepayAmount = displayRepayAmount > 0n;
  const accruedInterest = (debtParts?.[1] ?? 0n) + (debtParts?.[2] ?? 0n);
  const usdcDebt = (usdcDebtParts?.[0] ?? 0n) + (usdcDebtParts?.[1] ?? 0n) + (usdcDebtParts?.[2] ?? 0n);
  const eurcDebt = (eurcDebtParts?.[0] ?? 0n) + (eurcDebtParts?.[1] ?? 0n) + (eurcDebtParts?.[2] ?? 0n);
  const eurcUsdPrice = TESTNET_ORACLE.initialPrice;
  const currentDebtUsd = Number(formatUnits(usdcDebt, 6)) + Number(formatUnits(eurcDebt, 6)) * eurcUsdPrice;
  const collateralUsd = Number(formatUnits(v2CollateralUsdc, 6)) + Number(formatUnits(v2CollateralEurc, 6)) * eurcUsdPrice;
  const currentHf = oracleHealthy
    ? currentDebtUsd === 0 ? Number.POSITIVE_INFINITY : (collateralUsd * Number(liquidationThresholdBps)) / (currentDebtUsd * 10_000)
    : Number.NaN;
  const repaymentUsd = Number(formatUnits(displayRepayAmount > debt ? debt : displayRepayAmount, 6)) * (asset === 'EURC' ? eurcUsdPrice : 1);
  const projectedDebtUsd = Math.max(0, currentDebtUsd - repaymentUsd);
  const projectedHf = oracleHealthy
    ? projectedDebtUsd <= 0.0000005 ? Number.POSITIVE_INFINITY : (collateralUsd * Number(liquidationThresholdBps)) / (projectedDebtUsd * 10_000)
    : Number.NaN;
  const approveWrite = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approveWrite.data });
  const repayWrite = useWriteContract();
  const repayReceipt = useWaitForTransactionReceipt({ hash: repayWrite.data });
  const busy = approveWrite.isPending || approveReceipt.isLoading || repayWrite.isPending || repayReceipt.isLoading;

  useEffect(() => {
    if (!approveReceipt.isSuccess) return;
    void refetch();
  }, [approveReceipt.isSuccess, refetch]);
  useEffect(() => {
    if (!repayReceipt.isSuccess) return;
    void Promise.resolve(onTransactionConfirmed()).finally(() => onClose());
  }, [onClose, onTransactionConfirmed, repayReceipt.isSuccess]);
  useEffect(() => {
    if (!open) { setAmount(''); setFullRepayment(false); setError(null); approveWrite.reset(); repayWrite.reset(); }
  // Reset methods are stable Wagmi actions; intentionally reset only when drawer closes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!address || !publicClient || displayRepayAmount === 0n || debt === 0n || busy) return;
    setError(null);
    try {
      if (balance < displayRepayAmount) throw new Error(`Insufficient ${asset} balance to repay this amount.`);
      // For a full repayment the call uses maxUint256 so LendingPoolV2 caps at
      // current debt even if interest accrues between the UI read and mining.
      // Approval is deliberately maxUint256 too; compare it separately rather
      // than against the max repay sentinel on every retry.
      const requiredAllowance = fullRepayment ? maxUint256 : requested;
      if (allowance < requiredAllowance) {
        const approval = await publicClient.simulateContract({ account: address, address: assetAddress, abi: erc20Abi, functionName: 'approve', args: [V2_CONTRACTS.lendingPool, maxUint256] });
        await approveWrite.writeContractAsync(approval.request);
        return;
      }
      const latestAllowance = await publicClient.readContract({ address: assetAddress, abi: erc20Abi, functionName: 'allowance', args: [address, V2_CONTRACTS.lendingPool] });
      if (latestAllowance < requiredAllowance) {
        setError('Approval is still syncing on Arc. Please try Repay again shortly.');
        await refetch();
        return;
      }
      const request = await publicClient.simulateContract({ account: address, address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'repay', args: [assetAddress, repayAmount] });
      await repayWrite.writeContractAsync(request.request);
    } catch (caught) {
      setError(caught instanceof BaseError ? caught.shortMessage : caught instanceof Error ? caught.message : 'Repayment could not be prepared.');
    }
  };
  const buttonText = approveWrite.isPending ? 'Confirm approval in wallet…'
    : approveReceipt.isLoading ? 'Approving…'
      : repayWrite.isPending ? 'Confirm repayment in wallet…'
        : repayReceipt.isLoading ? 'Repaying…'
          : debt === 0n ? 'No active debt to repay'
            : !hasRepayAmount ? 'Enter an amount to repay'
              : allowance < (fullRepayment ? maxUint256 : requested) ? `Approve ${asset}` : `Repay ${asset}`;
  return <AnimatePresence>
    {open && <>
      <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div className="drawer-panel repay-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.3, ease: 'easeOut' }}>
        <div className="drawer-header"><h3>Repay</h3><button className="drawer-close" onClick={onClose} aria-label="Close repay drawer">×</button></div>
        <div className="drawer-field repay-drawer__field">
          <label>Asset to Repay</label>
          <div className="repay-asset-card">
            <TokenIcon symbol={asset} size={24} />
            <div><strong>{asset}</strong><span>Active borrowing position</span></div>
            <em>{formatToken(debt, 6)} {asset}</em>
          </div>
        </div>
        <div className="drawer-field repay-drawer__field">
          <label>Repay Amount</label>
          <div className="drawer-amount-input">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue !== '' && !/^\d*(?:\.\d{0,6})?$/.test(nextValue)) return;
                try {
                  const nextAmount = nextValue ? parseUnits(nextValue, 6) : 0n;
                  // A repayment must never be larger than the live debt. Matching
                  // it manually is treated exactly like MAX so the full-repay
                  // protection also applies to typed amounts.
                  if (debt > 0n && nextAmount >= debt) {
                    setAmount(formatUnits(debt, 6));
                    setFullRepayment(true);
                    return;
                  }
                } catch {
                  return;
                }
                setAmount(nextValue);
                setFullRepayment(false);
              }}
              placeholder="0.00"
              aria-label={`Repay amount in ${asset}`}
            />
            <button className="drawer-max-btn" type="button" onClick={() => { setAmount(formatUnits(debt, 6)); setFullRepayment(true); }}>MAX</button>
          </div>
          <span className="drawer-balance">Wallet balance: {formatToken(balance, 6)} {asset}</span>
        </div>
        <div className="borrow-metrics repay-metrics" aria-label="Repayment details">
          <div className="borrow-metric"><span>Current debt</span><strong>{formatToken(debt, 6)} {asset}</strong></div>
          <div className="borrow-metric"><span className="borrow-metric__label">Borrow APR <InfoTip text="The annualized cost of this loan, calculated from the current on-chain interest rate." /></span><strong>{formatApr(borrowRatePerSecond)}</strong></div>
          <div className="borrow-metric"><span>Accrued interest</span><strong>{formatToken(accruedInterest, 6)} {asset}</strong></div>
          <div className="borrow-metric"><span className="borrow-metric__label">Interest checkpoint <InfoTip text="Pending interest is calculated from this latest on-chain checkpoint." /></span><strong>{shortDate(loan?.[2] ?? 0n)}</strong></div>
        </div>
        <div className="hf-preview">
          <div className="hf-preview__header"><span>Risk preview</span><span>Current → Projected</span></div>
          <div className="hf-preview__row">
            <span className="hf-preview__label">Health Factor <InfoTip text="Health Factor measures your distance from liquidation. Repaying debt increases it." /></span>
            <span className="hf-preview__values repay-hf-values"><span style={{ color: hfColor(currentHf) }}>{hfLabel(currentHf)}</span><i aria-hidden="true">→</i><span style={{ color: hfColor(projectedHf) }}>{hfLabel(projectedHf)}</span></span>
          </div>
          <div className="hf-preview__row">
            <span>Debt after repayment</span>
            <span className="hf-preview__values">{formatToken(debt, 6)} {asset}<i aria-hidden="true">→</i><span>{formatToken(debt - (displayRepayAmount > debt ? debt : displayRepayAmount), 6)} {asset}</span></span>
          </div>
        </div>
        {!oracleHealthy && <p className="borrow-helper"><span className="borrow-helper__icon" aria-hidden="true">i</span><span>Health Factor preview is unavailable until the V2 oracle price is refreshed. Repayment itself remains available.</span></p>}
        {fullRepayment && <p className="borrow-helper">Full repayment uses a protected allowance and caps the final amount at your live debt.</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="drawer-actions repay-drawer__actions"><button className="cta-button" disabled={busy || debt === 0n || !hasRepayAmount} onClick={() => void submit()}>{buttonText}</button></div>
      </motion.div>
    </>}
  </AnimatePresence>;
}
