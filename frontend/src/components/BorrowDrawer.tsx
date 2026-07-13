import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseUnits, formatUnits } from 'viem';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, lendingPoolAbi, stakingVaultAbi, priceOracleAbi } from '../config/contracts';
import { TokenIcon } from './TokenIcon';

type Asset = 'USDC' | 'EURC';
const BPS_DENOMINATOR = 10_000;

function hfColor(hf: number) {
  if (hf >= 1_000_000) return '#4FD1C5';
  if (hf >= 1.5) return '#4FD1C5';
  if (hf >= 1.1) return '#E8B54C';
  return '#E5484D';
}

function formatHf(hf: number) {
  if (hf >= 1_000_000) return '∞';
  return hf.toFixed(2);
}

export function BorrowDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const [asset, setAsset] = useState<Asset>('USDC');
  const [amount, setAmount] = useState('');

  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const numericAmount = Number(amount);
  const amountWei = amount && !isNaN(numericAmount) && numericAmount > 0 ? parseUnits(amount, 6) : 0n;

  const { data } = useReadContracts({
    contracts: address
      ? [
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'collateralBalance', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'getTotalStakedByUser', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'getTotalStakedByUser', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.eurc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'maxLtvBps' },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'liquidationThresholdBps' },
          { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'viewPrice' },
        ]
      : [],
    query: { enabled: !!address && open },
  });

  const writeContract_ = useWriteContract();
  const tx = useWaitForTransactionReceipt({ hash: writeContract_.data });

  useEffect(() => {
    if (!open) {
      setAmount('');
      writeContract_.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!data) {
    return (
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
            <motion.div className="drawer-panel" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.3 }}>
              <div className="drawer-header">
                <h3>Borrow</h3>
                <button className="drawer-close" onClick={onClose}>×</button>
              </div>
              <p className="text-secondary">Loading…</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  const collateralUsdc = Number(formatUnits((data[0]?.result as bigint) ?? 0n, 6));
  const collateralEurc = Number(formatUnits((data[1]?.result as bigint) ?? 0n, 6));
  const stakedUsdc = Number(formatUnits((data[2]?.result as bigint) ?? 0n, 6));
  const stakedEurc = Number(formatUnits((data[3]?.result as bigint) ?? 0n, 6));
  const usdcLoan = data[4]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const eurcLoan = data[5]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const maxLtvBps = Number((data[6]?.result as bigint) ?? 7_500n);
  const liqThresholdBps = Number((data[7]?.result as bigint) ?? 8_330n);
  const oraclePrice = data[8]?.result as [bigint, bigint] | undefined;
  const eurcUsdPrice = oraclePrice ? Number(formatUnits(oraclePrice[0], 18)) : 1;

  const totalCollateralUsd = collateralUsdc + stakedUsdc + (collateralEurc + stakedEurc) * eurcUsdPrice;
  const usdcDebt = usdcLoan ? Number(formatUnits(usdcLoan[0] + usdcLoan[2], 6)) : 0;
  const eurcDebt = eurcLoan ? Number(formatUnits(eurcLoan[0] + eurcLoan[2], 6)) : 0;
  const totalDebtUsd = usdcDebt + eurcDebt * eurcUsdPrice;

  const borrowAmount = amountWei > 0n ? Number(formatUnits(amountWei, 6)) : 0;
  const borrowAmountUsd = asset === 'EURC' ? borrowAmount * eurcUsdPrice : borrowAmount;
  const newDebtUsd = totalDebtUsd + borrowAmountUsd;

  const hfBefore = totalDebtUsd === 0 ? 1_000_000 : (totalCollateralUsd * liqThresholdBps) / BPS_DENOMINATOR / totalDebtUsd;
  const hfAfter = newDebtUsd === 0 ? 1_000_000 : (totalCollateralUsd * liqThresholdBps) / BPS_DENOMINATOR / newDebtUsd;

  const projectedLtvBps = totalCollateralUsd > 0 ? (newDebtUsd * BPS_DENOMINATOR) / totalCollateralUsd : Infinity;
  const exceedsMaxLtv = borrowAmountUsd > 0 && projectedLtvBps > maxLtvBps;
  const noCollateral = totalCollateralUsd === 0;

  const isValidAmount = amountWei > 0n && !exceedsMaxLtv && !noCollateral;
  const success = tx.isSuccess;

  const handleBorrow = () => {
    writeContract_.writeContract({
      address: CONTRACTS.lendingPool,
      abi: lendingPoolAbi,
      functionName: 'borrow',
      args: [assetAddress, amountWei],
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="drawer-header">
              <h3>Borrow</h3>
              <button className="drawer-close" onClick={onClose}>×</button>
            </div>

            {success ? (
              <div className="drawer-success">
                <span className="drawer-success__icon">✓</span>
                <p>Borrow successful!</p>
                <p className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  Your position will appear in the Dashboard shortly.
                </p>
                <button className="cta-button" onClick={onClose} style={{ marginTop: 20 }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="drawer-field">
                  <label>Asset to Borrow</label>
                  <div className="asset-toggle">
                    {(['USDC', 'EURC'] as Asset[]).map((a) => (
                      <button
                        key={a}
                        className={`asset-toggle__btn ${asset === a ? 'asset-toggle__btn--active' : ''}`}
                        onClick={() => setAsset(a)}
                      >
                        <TokenIcon symbol={a} size={20} />
                        {a}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="drawer-field">
                  <label>Amount</label>
                  <div className="drawer-amount-input">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || Number(value) >= 0) {
                          setAmount(value);
                        }
                      }}
                    />
                  </div>
                  <span className="text-secondary" style={{ fontSize: '0.78rem' }}>
                    Available collateral: ${totalCollateralUsd.toFixed(2)}
                  </span>
                </div>

                <div className="hf-preview">
                  <div className="hf-preview__row">
                    <span>Health Factor</span>
                    <span>
                      <span style={{ color: hfColor(hfBefore) }}>{formatHf(hfBefore)}</span>
                      {' → '}
                      <span style={{ color: hfColor(hfAfter) }}>{formatHf(hfAfter)}</span>
                    </span>
                  </div>
                </div>

                {noCollateral && (
                  <p style={{ color: 'var(--color-danger, #E5484D)', fontSize: '0.82rem' }}>
                    You have no collateral (staked or deposited). Stake assets first.
                  </p>
                )}
                {exceedsMaxLtv && !noCollateral && (
                  <p style={{ color: 'var(--color-danger, #E5484D)', fontSize: '0.82rem' }}>
                    This exceeds the max LTV ({(maxLtvBps / 100).toFixed(0)}%). Try a smaller amount.
                  </p>
                )}

                <div className="drawer-actions">
                  <button
                    className="cta-button"
                    disabled={!isValidAmount || writeContract_.isPending || tx.isLoading}
                    onClick={handleBorrow}
                  >
                    {writeContract_.isPending
                      ? 'Confirm in wallet…'
                      : tx.isLoading
                      ? 'Borrowing…'
                      : 'Borrow'}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
