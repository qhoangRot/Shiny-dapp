import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatUnits, parseUnits } from 'viem';
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { CONTRACTS, TESTNET_ORACLE, lendingPoolAbi, priceOracleAbi, stakingVaultAbi } from '../config/contracts';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { InfoTip } from './InfoTip';
import { TokenIcon } from './TokenIcon';

type Asset = 'USDC' | 'EURC';

const BPS_DENOMINATOR = 10_000;
const SECONDS_PER_YEAR = 31_536_000;

function hfColor(hf: number) {
  if (!Number.isFinite(hf)) return '#4FD1C5';
  if (hf >= 1.5) return '#4FD1C5';
  if (hf >= 1.1) return '#E8B54C';
  return '#E5484D';
}

function formatHf(hf: number) {
  if (!Number.isFinite(hf)) return '∞';
  return hf.toFixed(2);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value.toFixed(2)}%`;
}

function secondsRateToApr(ratePerSecond: bigint) {
  return Number(formatUnits(ratePerSecond, 18)) * SECONDS_PER_YEAR * 100;
}

interface BorrowDrawerProps {
  open: boolean;
  onClose: () => void;
  onTransactionConfirmed?: () => void | Promise<void>;
}

export function BorrowDrawer({
  open,
  onClose,
  onTransactionConfirmed,
}: BorrowDrawerProps) {
  const { address } = useAccount();
  const refreshProtocolData = useRefreshProtocolData();
  const syncedBorrowHash = useRef<`0x${string}` | undefined>(undefined);
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
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'borrowRatePerSecond', args: [assetAddress] },
          { address: CONTRACTS.priceOracle, abi: priceOracleAbi, functionName: 'viewPrice', args: [] },
        ]
      : [],
    query: { enabled: !!address && open },
  });

  const borrowWrite = useWriteContract();
  const borrowTx = useWaitForTransactionReceipt({ hash: borrowWrite.data });

  useEffect(() => {
    const hash = borrowWrite.data;
    if (!borrowTx.isSuccess || !hash || syncedBorrowHash.current === hash) return;

    syncedBorrowHash.current = hash;
    void Promise.all([
      refreshProtocolData(),
      Promise.resolve(onTransactionConfirmed?.()),
    ]);
  }, [
    borrowTx.isSuccess,
    borrowWrite.data,
    onTransactionConfirmed,
    refreshProtocolData,
  ]);

  useEffect(() => {
    if (!open) {
      setAmount('');
      borrowWrite.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const renderShell = (children: React.ReactNode) => (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (!data) {
    return renderShell(
      <>
        <div className="drawer-header">
          <h3>Borrow</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close borrow drawer">×</button>
        </div>
        <p className="text-secondary">Loading...</p>
      </>,
    );
  }

  const collateralUsdc = Number(formatUnits((data[0]?.result as bigint) ?? 0n, 6));
  const collateralEurc = Number(formatUnits((data[1]?.result as bigint) ?? 0n, 6));
  const stakedUsdc = Number(formatUnits((data[2]?.result as bigint) ?? 0n, 6));
  const stakedEurc = Number(formatUnits((data[3]?.result as bigint) ?? 0n, 6));
  const usdcLoan = data[4]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const eurcLoan = data[5]?.result as [bigint, bigint, bigint, boolean] | undefined;
  const maxLtvBps = Number((data[6]?.result as bigint) ?? 7_500n);
  const liquidationThresholdBps = Number((data[7]?.result as bigint) ?? 8_330n);
  const ratePerSecond = (data[8]?.result as bigint) ?? 0n;
  const oraclePrice = data[9]?.result as [bigint, bigint] | undefined;
  const eurcUsdPrice = oraclePrice && oraclePrice[0] > 0n
    ? Number(formatUnits(oraclePrice[0], 18))
    : 0;
  const oracleAvailable = eurcUsdPrice > 0;

  const totalCollateralUsd = collateralUsdc + stakedUsdc + (collateralEurc + stakedEurc) * eurcUsdPrice;
  const usdcDebt = usdcLoan ? Number(formatUnits(usdcLoan[0] + usdcLoan[2], 6)) : 0;
  const eurcDebt = eurcLoan ? Number(formatUnits(eurcLoan[0] + eurcLoan[2], 6)) : 0;
  const totalDebtUsd = usdcDebt + eurcDebt * eurcUsdPrice;

  const borrowAmount = amountWei > 0n ? Number(formatUnits(amountWei, 6)) : 0;
  const borrowAmountUsd = asset === 'EURC' ? borrowAmount * eurcUsdPrice : borrowAmount;
  const newDebtUsd = totalDebtUsd + borrowAmountUsd;

  const hfBefore =
    totalDebtUsd === 0
      ? Number.POSITIVE_INFINITY
      : (totalCollateralUsd * liquidationThresholdBps) / BPS_DENOMINATOR / totalDebtUsd;
  const hfAfter =
    newDebtUsd === 0
      ? Number.POSITIVE_INFINITY
      : (totalCollateralUsd * liquidationThresholdBps) / BPS_DENOMINATOR / newDebtUsd;

  const currentLtvBps = totalCollateralUsd > 0 ? (totalDebtUsd * BPS_DENOMINATOR) / totalCollateralUsd : 0;
  const projectedLtvBps = totalCollateralUsd > 0 ? (newDebtUsd * BPS_DENOMINATOR) / totalCollateralUsd : Infinity;
  const remainingBorrowUsd = Math.max(0, (totalCollateralUsd * maxLtvBps) / BPS_DENOMINATOR - totalDebtUsd);
  const maxBorrowInAsset =
    asset === 'EURC'
      ? oracleAvailable
        ? remainingBorrowUsd / eurcUsdPrice
        : 0
      : remainingBorrowUsd;
  const borrowApr = secondsRateToApr(ratePerSecond);

  const noCollateral = totalCollateralUsd === 0;
  const exceedsMaxLtv = borrowAmountUsd > 0 && projectedLtvBps > maxLtvBps;
  const lowHealthFactor = borrowAmountUsd > 0 && hfAfter < 1.2;
  const isValidAmount =
    oracleAvailable && amountWei > 0n && !noCollateral && !exceedsMaxLtv && !lowHealthFactor;
  const success = borrowTx.isSuccess;

  const helperText = !oracleAvailable
    ? `${TESTNET_ORACLE.pair} testnet price is unavailable. Borrowing is disabled.`
    : noCollateral
      ? 'Stake or deposit collateral before borrowing.'
    : exceedsMaxLtv
      ? `This borrow would exceed Max LTV (${(maxLtvBps / 100).toFixed(0)}%).`
      : lowHealthFactor
        ? 'Health Factor would be too close to liquidation. Try a smaller amount.'
        : amountWei === 0n
          ? 'Enter an amount to preview your loan.'
          : 'Review the risk preview before confirming in your wallet.';

  const handleBorrow = () => {
    borrowWrite.writeContract({
      address: CONTRACTS.lendingPool,
      abi: lendingPoolAbi,
      functionName: 'borrow',
      args: [assetAddress, amountWei],
    });
  };

  return renderShell(
    <>
      <div className="drawer-header">
        <h3>Borrow</h3>
        <button className="drawer-close" onClick={onClose} aria-label="Close borrow drawer">×</button>
      </div>

      {success ? (
        <div className="drawer-success">
          <span className="drawer-success__icon">OK</span>
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
              {(['USDC', 'EURC'] as Asset[]).map((item) => (
                <button
                  key={item}
                  className={`asset-toggle__btn ${asset === item ? 'asset-toggle__btn--active' : ''}`}
                  onClick={() => setAsset(item)}
                >
                  <TokenIcon symbol={item} size={20} />
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="drawer-field">
            <label>Borrow Amount</label>
            <div className="drawer-amount-input">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '' || Number(value) >= 0) {
                    setAmount(value);
                  }
                }}
              />
              <button
                className="drawer-max-btn"
                onClick={() => setAmount(maxBorrowInAsset > 0 ? maxBorrowInAsset.toFixed(6) : '')}
              >
                MAX
              </button>
            </div>
            <span className="drawer-balance">
              Available to borrow: {maxBorrowInAsset.toFixed(2)} {asset}
            </span>
          </div>

          <div className="borrow-oracle-card">
            <div className="borrow-oracle-card__label">
              <span>Testnet FX</span>
              <em className="simulated-badge">Simulated</em>
            </div>
            <strong className={!oracleAvailable ? 'borrow-oracle-card__value--danger' : ''}>
              {oracleAvailable ? `1 EURC = $${eurcUsdPrice.toFixed(4)}` : 'Unavailable'}
            </strong>
          </div>

          <div className="borrow-metrics" aria-label="Current borrowing metrics">
            <div className="borrow-metric">
              <span>Total collateral</span>
              <strong>{formatUsd(totalCollateralUsd)}</strong>
            </div>
            <div className="borrow-metric">
              <span>Current debt</span>
              <strong>{formatUsd(totalDebtUsd)}</strong>
            </div>
            <div className="borrow-metric">
              <span className="borrow-metric__label">
                Borrow APR
                <InfoTip text="The annualized cost of borrowing this asset, calculated from its current on-chain interest rate." />
              </span>
              <strong>{formatPercent(borrowApr)}</strong>
            </div>
            <div className="borrow-metric">
              <span className="borrow-metric__label">
                Max LTV
                <InfoTip text="Maximum loan-to-value is the largest debt allowed relative to the value of your collateral." />
              </span>
              <strong>{(maxLtvBps / 100).toFixed(0)}%</strong>
            </div>
          </div>

          <div className="hf-preview">
            <div className="hf-preview__header">
              <span>Risk preview</span>
              <span>Current → Projected</span>
            </div>
            <div className="hf-preview__row">
              <span className="hf-preview__label">
                Health Factor
                <InfoTip text="Health Factor measures your distance from liquidation. At or below 1.00 your position can be liquidated; ∞ means there is no active debt." />
              </span>
              <span className="hf-preview__values">
                <span style={{ color: hfColor(hfBefore) }}>{formatHf(hfBefore)}</span>
                <i aria-hidden="true">→</i>
                <span style={{ color: hfColor(hfAfter) }}>{formatHf(hfAfter)}</span>
              </span>
            </div>
            <div className="hf-preview__row">
              <span>LTV</span>
              <span className="hf-preview__values">
                {formatPercent(currentLtvBps / 100)}
                <i aria-hidden="true">→</i>
                <span style={{ color: exceedsMaxLtv ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                  {formatPercent(projectedLtvBps / 100)}
                </span>
              </span>
            </div>
          </div>

          <p className={`borrow-helper ${!oracleAvailable || noCollateral || exceedsMaxLtv || lowHealthFactor ? 'borrow-helper--danger' : ''}`}>
            <span className="borrow-helper__icon" aria-hidden="true">
              {!oracleAvailable || noCollateral || exceedsMaxLtv || lowHealthFactor ? '!' : 'i'}
            </span>
            <span>{helperText}</span>
          </p>

          <div className="drawer-actions">
            <button
              className="cta-button"
              disabled={!isValidAmount || borrowWrite.isPending || borrowTx.isLoading}
              onClick={handleBorrow}
            >
              {borrowWrite.isPending ? 'Confirm in wallet...' : borrowTx.isLoading ? 'Borrowing...' : 'Borrow'}
            </button>
          </div>
        </>
      )}
    </>,
  );
}
