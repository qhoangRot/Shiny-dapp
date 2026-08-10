import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BaseError, formatUnits, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { CONTRACTS, TESTNET_ORACLE, V2_CONTRACTS, lendingPoolV2Abi, oracleAdapterV2Abi, stakingVaultV2Abi } from '../config/contracts';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { InfoTip } from './InfoTip';
import { TokenIcon } from './TokenIcon';

type Asset = 'USDC' | 'EURC';

const BPS_DENOMINATOR = 10_000;
const SECONDS_PER_YEAR = 31_536_000;

function parseTokenAmount(value: string) {
  if (!value || !/^\d*(?:\.\d{0,6})?$/.test(value)) return 0n;
  try {
    return parseUnits(value, 6);
  } catch {
    return 0n;
  }
}

function transactionErrorMessage(error: unknown) {
  const message = error instanceof BaseError
    ? error.shortMessage
    : error instanceof Error
      ? error.message
      : 'The transaction could not be prepared.';
  if (/user rejected|user denied/i.test(message)) return 'Transaction cancelled in your wallet.';
  if (/Max LTV|Vay vuot qua/i.test(message)) return 'This borrow would exceed Max LTV.';
  if (/collateral|tai san the chap/i.test(message)) return 'No eligible collateral is available.';
  if (/balance|transfer amount exceeds/i.test(message)) return 'The lending pool does not have enough liquidity.';
  if (/paused/i.test(message)) return 'Borrowing is temporarily paused.';
  if (/oracle|price/i.test(message)) return 'Oracle price needs refresh, try again shortly.';
  return message;
}

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
  const publicClient = usePublicClient();
  const refreshProtocolData = useRefreshProtocolData();
  const syncedBorrowHash = useRef<`0x${string}` | undefined>(undefined);
  const [asset, setAsset] = useState<Asset>('USDC');
  const [collateralAsset, setCollateralAsset] = useState<Asset>('EURC');
  const [amount, setAmount] = useState('');
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const collateralAddress = collateralAsset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const amountWei = parseTokenAmount(amount);

  const { data, error: readError } = useReadContracts({
    contracts: address
      ? [
          { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'getTotalSeizablePrincipal', args: [address, CONTRACTS.usdc] },
          { address: V2_CONTRACTS.stakingVault, abi: stakingVaultV2Abi, functionName: 'getTotalSeizablePrincipal', args: [address, CONTRACTS.eurc] },
          { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt', args: [address, CONTRACTS.usdc] },
          { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'getCurrentDebt', args: [address, CONTRACTS.eurc] },
          { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'maxLtvBps' },
          { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'liquidationThresholdBps' },
          { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'borrowRatePerSecond', args: [assetAddress] },
          { address: V2_CONTRACTS.lendingPool, abi: lendingPoolV2Abi, functionName: 'canBorrow', args: [collateralAddress, assetAddress] },
          { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'isHealthy', args: [CONTRACTS.usdc] },
          { address: V2_CONTRACTS.oracleAdapter, abi: oracleAdapterV2Abi, functionName: 'isHealthy', args: [CONTRACTS.eurc] },
        ]
      : [],
    query: { enabled: !!address && open },
  });

  const borrowWrite = useWriteContract();
  const borrowTx = useWaitForTransactionReceipt({ hash: borrowWrite.data });
  const isBusy = borrowWrite.isPending || borrowTx.isLoading;
  const visibleError = transactionError
    ?? (borrowWrite.error ? transactionErrorMessage(borrowWrite.error) : null)
    ?? (borrowTx.error ? transactionErrorMessage(borrowTx.error) : null)
    ?? (readError ? transactionErrorMessage(readError) : null);

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
      setTransactionError(null);
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
            onClick={() => { if (!isBusy) onClose(); }}
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
          <button className="drawer-close" onClick={onClose} aria-label="Close borrow drawer" disabled={isBusy}>×</button>
        </div>
        <p className="text-secondary">Loading...</p>
      </>,
    );
  }

  const stakedUsdc = Number(formatUnits((data[0]?.result as bigint) ?? 0n, 6));
  const stakedEurc = Number(formatUnits((data[1]?.result as bigint) ?? 0n, 6));
  const usdcLoan = data[2]?.result as [bigint, bigint, bigint] | undefined;
  const eurcLoan = data[3]?.result as [bigint, bigint, bigint] | undefined;
  const maxLtvBps = Number((data[4]?.result as bigint) ?? 7_500n);
  const liquidationThresholdBps = Number((data[5]?.result as bigint) ?? 8_330n);
  const ratePerSecond = (data[6]?.result as bigint) ?? 0n;
  const borrowPairEnabled = data[7]?.result === true;
  const oracleAvailable = data[8]?.result === true && data[9]?.result === true;
  const eurcUsdPrice = TESTNET_ORACLE.initialPrice;

  const totalCollateralUsd = stakedUsdc + stakedEurc * eurcUsdPrice;
  const usdcDebt = usdcLoan ? Number(formatUnits(usdcLoan[0] + usdcLoan[1] + usdcLoan[2], 6)) : 0;
  const eurcDebt = eurcLoan ? Number(formatUnits(eurcLoan[0] + eurcLoan[1] + eurcLoan[2], 6)) : 0;
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
  const isValidAmount = oracleAvailable && borrowPairEnabled && collateralAsset !== asset
    && amountWei > 0n && !noCollateral && !exceedsMaxLtv && !lowHealthFactor;
  const success = borrowTx.isSuccess;

  const helperText = !oracleAvailable
    ? `${TESTNET_ORACLE.pair} testnet price is unavailable. Borrowing is disabled.`
    : !borrowPairEnabled || collateralAsset === asset
      ? 'Choose the opposite staked asset as collateral.'
    : noCollateral
      ? 'Stake or deposit collateral before borrowing.'
    : exceedsMaxLtv
      ? `This borrow would exceed Max LTV (${(maxLtvBps / 100).toFixed(0)}%).`
      : lowHealthFactor
        ? 'Health Factor would be too close to liquidation. Try a smaller amount.'
        : amountWei === 0n
          ? 'Enter an amount to preview your loan.'
          : 'Review the risk preview before confirming in your wallet.';

  const handleBorrow = async () => {
    if (!isValidAmount || !address || !publicClient || isBusy) return;
    setTransactionError(null);
    try {
      const { request } = await publicClient.simulateContract({
        account: address,
        address: V2_CONTRACTS.lendingPool,
        abi: lendingPoolV2Abi,
        functionName: 'borrow',
        args: [collateralAddress, assetAddress, amountWei],
      });
      await borrowWrite.writeContractAsync(request);
    } catch (error) {
      setTransactionError(transactionErrorMessage(error));
    }
  };

  return renderShell(
    <>
      <div className="drawer-header">
        <h3>Borrow</h3>
        <button className="drawer-close" onClick={onClose} aria-label="Close borrow drawer" disabled={isBusy}>×</button>
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
            <label>Collateral Asset</label>
            <div className="asset-toggle">
              {(['USDC', 'EURC'] as Asset[]).map((item) => (
                <button
                  key={item}
                  className={`asset-toggle__btn ${collateralAsset === item ? 'asset-toggle__btn--active' : ''}`}
                  onClick={() => {
                    setCollateralAsset(item);
                    if (item === asset) setAsset(item === 'USDC' ? 'EURC' : 'USDC');
                    setAmount('');
                    setTransactionError(null);
                    borrowWrite.reset();
                  }}
                  disabled={isBusy}
                >
                  <TokenIcon symbol={item} size={20} />
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="drawer-field">
            <label>Asset to Borrow</label>
            <div className="asset-toggle">
              {(['USDC', 'EURC'] as Asset[]).map((item) => (
                <button
                  key={item}
                  className={`asset-toggle__btn ${asset === item ? 'asset-toggle__btn--active' : ''}`}
                  onClick={() => {
                    setAsset(item);
                    if (item === collateralAsset) setCollateralAsset(item === 'USDC' ? 'EURC' : 'USDC');
                    setAmount('');
                    setTransactionError(null);
                    borrowWrite.reset();
                  }}
                  disabled={isBusy}
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
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '' || /^\d*(?:\.\d{0,6})?$/.test(value)) {
                    setAmount(value);
                    setTransactionError(null);
                    borrowWrite.reset();
                  }
                }}
                disabled={isBusy}
              />
              <button
                className="drawer-max-btn"
                onClick={() => {
                  setAmount(maxBorrowInAsset > 0 ? maxBorrowInAsset.toFixed(6) : '');
                  setTransactionError(null);
                  borrowWrite.reset();
                }}
                disabled={isBusy}
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

          {visibleError && (
            <div className="stake-read-error" role="alert">
              <span>{visibleError}</span>
              <button type="button" onClick={() => setTransactionError(null)}>Dismiss</button>
            </div>
          )}

          <div className="drawer-actions">
            <button
              className="cta-button"
              disabled={!isValidAmount || borrowWrite.isPending || borrowTx.isLoading}
              onClick={() => void handleBorrow()}
            >
              {borrowWrite.isPending ? 'Confirm in wallet...' : borrowTx.isLoading ? 'Borrowing...' : 'Borrow'}
            </button>
          </div>
        </>
      )}
    </>,
  );
}
