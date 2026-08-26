import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatUnits, parseUnits } from 'viem';
import { useRepay, type RepayAsset } from '../hooks/useRepay';
import { InfoTip } from './InfoTip';
import { TokenIcon } from './TokenIcon';

const SECONDS_PER_YEAR = 31_536_000;

interface RepayDrawerProps {
  open: boolean;
  asset: RepayAsset;
  onClose: () => void;
  onTransactionConfirmed?: () => void | Promise<void>;
}

function parseTokenAmount(value: string) {
  if (!value || !/^\d*(?:\.\d{0,6})?$/.test(value)) return 0n;

  try {
    return parseUnits(value, 6);
  } catch {
    return 0n;
  }
}

function formatToken(value: bigint, digits = 4) {
  return Number(formatUnits(value, 6)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

function formatApr(ratePerSecond: bigint) {
  const apr = Number(formatUnits(ratePerSecond, 18)) * SECONDS_PER_YEAR * 100;
  return Number.isFinite(apr) ? `${apr.toFixed(2)}%` : '--';
}

function healthFactorColor(value: number) {
  if (!Number.isFinite(value)) return '#4FD1C5';
  if (value >= 1.5) return '#4FD1C5';
  if (value >= 1.1) return '#E8B54C';
  return '#E5484D';
}

function healthFactorLabel(value: number, noActiveLoans = false) {
  if (noActiveLoans || value === Number.POSITIVE_INFINITY) return 'No Active Loans';
  if (!Number.isFinite(value)) return '--';
  return value.toFixed(2);
}

function shortDate(timestamp: bigint) {
  if (timestamp === 0n) return '--';
  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Number(timestamp) * 1_000));
}

export function RepayDrawer({
  open,
  asset,
  onClose,
  onTransactionConfirmed,
}: RepayDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [amount, setAmount] = useState('');
  const [fullRepay, setFullRepay] = useState(false);
  const amountWei = useMemo(() => parseTokenAmount(amount), [amount]);

  const {
    snapshot,
    readsLoading,
    readsFetching,
    needsApproval,
    approve,
    repay,
    refresh,
    clearError,
    error,
    preparing,
    approveWalletPending,
    approving,
    approvalConfirmed,
    repayWalletPending,
    repaying,
    repaySuccess,
    isBusy,
  } = useRepay({
    open,
    asset,
    amount: amountWei,
    onTransactionConfirmed,
  });

  useEffect(() => {
    setAmount('');
    setFullRepay(false);
  }, [asset, open]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => {
      drawerRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBusy, onClose, open]);

  const selectedPrice = asset === 'EURC'
    ? snapshot?.eurcUsdPrice ?? 0
    : 1;
  const hasEurcExposure = (snapshot?.eurcLiveDebt ?? 0n) > 0n;
  const previewAvailable = !!snapshot
    && (!hasEurcExposure || snapshot.eurcUsdPrice > 0);

  const currentDebtUsd = snapshot
    ? Number(formatUnits(snapshot.usdcLiveDebt, 6))
      + Number(formatUnits(snapshot.eurcLiveDebt, 6)) * snapshot.eurcUsdPrice
    : 0;
  const storedDebtUsd = snapshot
    ? Number(formatUnits(snapshot.usdcStoredDebt, 6))
      + Number(formatUnits(snapshot.eurcStoredDebt, 6)) * snapshot.eurcUsdPrice
    : 0;
  const currentHf = snapshot && previewAvailable
    ? currentDebtUsd === 0
      ? Number.POSITIVE_INFINITY
      : Number.isFinite(snapshot.rawHealthFactor) && storedDebtUsd > 0
        ? (snapshot.rawHealthFactor * storedDebtUsd) / currentDebtUsd
        : snapshot.rawHealthFactor
    : Number.NaN;

  const repaymentWei = snapshot
    ? fullRepay
      ? snapshot.currentDebt
      : amountWei < snapshot.currentDebt
        ? amountWei
        : snapshot.currentDebt
    : 0n;
  const repaymentUsd = Number(formatUnits(repaymentWei, 6)) * selectedPrice;
  const projectedDebtUsd = Math.max(0, currentDebtUsd - repaymentUsd);
  const adjustedCollateralUsd = Number.isFinite(currentHf)
    ? currentHf * currentDebtUsd
    : 0;
  const projectedHf = previewAvailable
    ? projectedDebtUsd <= 0.0000005
      ? Number.POSITIVE_INFINITY
      : adjustedCollateralUsd > 0
        ? adjustedCollateralUsd / projectedDebtUsd
        : currentHf
    : Number.NaN;

  const noDebt = !!snapshot && snapshot.currentDebt === 0n;
  const amountTooHigh = !!snapshot
    && !fullRepay
    && amountWei > snapshot.currentDebt;
  // Approvals and repayments always use the amount selected by the user.
  // MAX fills the currently displayed debt; it never grants unlimited access.
  const requiredBalance = snapshot ? amountWei : 0n;
  const insufficientBalance = !!snapshot
    && requiredBalance > 0n
    && snapshot.balance < requiredBalance;
  const validAmount = !!snapshot
    && !noDebt
    && amountWei > 0n
    && !amountTooHigh
    && !insufficientBalance;

  const updateAmount = (value: string) => {
    if (value !== '' && !/^\d*(?:\.\d{0,6})?$/.test(value)) return;
    clearError();
    setAmount(value);
    const nextAmountWei = parseTokenAmount(value);
    // Typing the exact displayed debt must be just as safe as pressing MAX.
    // Persist the full-repay intent once matched so interest accruing on the
    // next block cannot silently turn this into a partial repayment.
    setFullRepay(
      !!snapshot
      && snapshot.currentDebt > 0n
      && nextAmountWei === snapshot.currentDebt,
    );
  };

  const selectMax = () => {
    if (!snapshot || snapshot.currentDebt === 0n) return;
    clearError();
    setAmount(formatUnits(snapshot.currentDebt, 6));
    setFullRepay(true);
  };

  const handleClose = () => {
    if (!isBusy) onClose();
  };

  const helper = noDebt
    ? { danger: false, text: 'No active debt to repay.' }
    : insufficientBalance
      ? {
          danger: true,
          text: `Your wallet does not have enough ${asset} for this repayment.`,
        }
      : amountTooHigh
        ? { danger: true, text: 'Repay amount cannot exceed the current debt. Use MAX to close it in full.' }
        : amountWei === 0n
          ? { danger: false, text: 'Enter an amount to preview the effect on your Health Factor.' }
          : fullRepay
            ? {
                danger: false,
                text: 'Full repayment selected. Approval is limited to the current displayed debt amount.',
              }
            : needsApproval
              ? { danger: false, text: `Approve the Lending Pool to use this ${asset} amount, then confirm Repay.` }
              : { danger: false, text: 'Allowance is ready. Review the projected Health Factor before repaying.' };

  let buttonLabel = `Repay ${asset}`;
  if (!snapshot) {
    buttonLabel = readsLoading || readsFetching
      ? 'Loading debt...'
      : 'Debt unavailable';
  }
  else if (noDebt) buttonLabel = 'No active debt to repay';
  else if (amountWei === 0n) buttonLabel = 'Enter an amount';
  else if (amountTooHigh) buttonLabel = 'Amount exceeds debt';
  else if (insufficientBalance) buttonLabel = `Insufficient ${asset} balance`;
  else if (preparing === 'sync') {
    buttonLabel = approvalConfirmed && !repaySuccess
      ? 'Verifying approval...'
      : 'Updating portfolio...';
  } else if (needsApproval) {
    if (preparing === 'approve') buttonLabel = 'Checking approval...';
    else if (approveWalletPending) buttonLabel = 'Confirm approval in wallet...';
    else if (approving) buttonLabel = 'Approving...';
    else buttonLabel = `Approve ${asset}`;
  } else {
    if (preparing === 'repay') buttonLabel = 'Checking repayment...';
    else if (repayWalletPending) buttonLabel = 'Confirm repayment in wallet...';
    else if (repaying) buttonLabel = 'Repaying...';
    else buttonLabel = fullRepay ? 'Repay full amount' : `Repay ${asset}`;
  }

  const handlePrimaryAction = () => {
    if (!validAmount || isBusy) return;
    if (needsApproval) {
      void approve();
    } else {
      void repay();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            aria-hidden="true"
          />
          <motion.aside
            ref={drawerRef}
            className="drawer-panel repay-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="repay-drawer-title"
            tabIndex={-1}
          >
            <div className="drawer-header">
              <h3 id="repay-drawer-title">Repay</h3>
              <button
                className="drawer-close"
                onClick={handleClose}
                aria-label="Close repay drawer"
                disabled={isBusy}
              >
                ×
              </button>
            </div>

            {repaySuccess ? (
              <div className="drawer-success">
                <span className="drawer-success__icon">✓</span>
                <p>Repayment successful</p>
                <p className="text-secondary" style={{ fontSize: '0.85rem' }}>
                  {preparing === 'sync'
                    ? 'Updating your debt and Health Factor...'
                    : 'Your portfolio is up to date.'}
                </p>
                <button
                  className="cta-button"
                  onClick={onClose}
                  style={{ marginTop: 20 }}
                  disabled={preparing === 'sync'}
                >
                  {preparing === 'sync' ? 'Updating...' : 'Done'}
                </button>
              </div>
            ) : (
              <>
                <div className="drawer-field">
                  <label>Asset to Repay</label>
                  <div className="repay-asset-card">
                    <TokenIcon symbol={asset} size={24} />
                    <div>
                      <strong>{asset}</strong>
                      <span>Active borrowing position</span>
                    </div>
                    <em>{snapshot ? `${formatToken(snapshot.currentDebt, 6)} ${asset}` : 'Loading...'}</em>
                  </div>
                </div>

                <div className="drawer-field">
                  <label>Repay Amount</label>
                  <div className="drawer-amount-input">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(event) => updateAmount(event.target.value)}
                      disabled={!snapshot || noDebt || isBusy}
                      aria-label={`Repay amount in ${asset}`}
                    />
                    <button
                      className="drawer-max-btn"
                      onClick={selectMax}
                      disabled={!snapshot || noDebt || isBusy}
                    >
                      MAX
                    </button>
                  </div>
                  <span className="drawer-balance">
                    Wallet balance: {snapshot ? formatToken(snapshot.balance, 6) : '--'} {asset}
                  </span>
                </div>

                <div className="borrow-metrics repay-metrics" aria-label="Repayment details">
                  <div className="borrow-metric">
                    <span>Current debt</span>
                    <strong>{snapshot ? formatToken(snapshot.currentDebt, 6) : '--'} {asset}</strong>
                  </div>
                  <div className="borrow-metric">
                    <span className="borrow-metric__label">
                      Borrow APR
                      <InfoTip text="The annualized cost of this loan, calculated from the current on-chain interest rate." />
                    </span>
                    <strong>{snapshot ? formatApr(snapshot.ratePerSecond) : '--'}</strong>
                  </div>
                  <div className="borrow-metric">
                    <span>Accrued interest</span>
                    <strong>{snapshot ? formatToken(snapshot.liveInterest, 6) : '--'} {asset}</strong>
                  </div>
                  <div className="borrow-metric">
                    <span className="borrow-metric__label">
                      Interest checkpoint
                      <InfoTip text="Pending interest is calculated from this latest on-chain checkpoint. It is not necessarily the original borrow date." />
                    </span>
                    <strong>{snapshot ? shortDate(snapshot.lastAccrualTime) : '--'}</strong>
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
                      <InfoTip text="Health Factor measures your distance from liquidation. Repaying debt increases it; no remaining loans returns the portfolio to No Active Loans." />
                    </span>
                    <span className="hf-preview__values repay-hf-values">
                      <span style={{ color: healthFactorColor(currentHf) }}>
                        {healthFactorLabel(currentHf, currentDebtUsd === 0)}
                      </span>
                      <i aria-hidden="true">→</i>
                      <span style={{ color: healthFactorColor(projectedHf) }}>
                        {healthFactorLabel(projectedHf, projectedDebtUsd <= 0.0000005)}
                      </span>
                    </span>
                  </div>
                  <div className="hf-preview__row">
                    <span>Debt after repayment</span>
                    <span className="hf-preview__values">
                      {snapshot
                        ? `${formatToken(snapshot.currentDebt, 6)} ${asset}`
                        : '--'}
                      <i aria-hidden="true">→</i>
                      <span>
                        {snapshot
                          ? `${formatToken(snapshot.currentDebt - repaymentWei, 6)} ${asset}`
                          : '--'}
                      </span>
                    </span>
                  </div>
                </div>

                {!previewAvailable && snapshot && (
                  <p className="borrow-helper">
                    <span className="borrow-helper__icon" aria-hidden="true">i</span>
                    <span>
                      Health Factor preview is unavailable while the EUR/USD testnet price is unavailable.
                      Repayment itself does not depend on the oracle.
                    </span>
                  </p>
                )}

                <p className={`borrow-helper ${helper.danger ? 'borrow-helper--danger' : ''}`}>
                  <span className="borrow-helper__icon" aria-hidden="true">
                    {helper.danger ? '!' : 'i'}
                  </span>
                  <span>{helper.text}</span>
                </p>

                {error && (
                  <p className="borrow-helper borrow-helper--danger" role="alert">
                    <span className="borrow-helper__icon" aria-hidden="true">!</span>
                    <span>{error}</span>
                  </p>
                )}

                <div className="drawer-actions">
                  <span className="sr-only" aria-live="polite">{buttonLabel}</span>
                  <button
                    className="cta-button"
                    disabled={!validAmount || isBusy || (!snapshot && readsFetching)}
                    onClick={handlePrimaryAction}
                  >
                    {buttonLabel}
                  </button>
                  {!snapshot && !readsLoading && (
                    <button
                      className="repay-retry"
                      type="button"
                      onClick={() => void refresh()}
                      disabled={readsFetching}
                    >
                      {readsFetching ? 'Refreshing debt...' : 'Retry debt check'}
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
