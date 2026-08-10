import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BaseError, formatUnits, parseUnits } from 'viem';
import { useAccount, usePublicClient, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { CONTRACTS, V2_CONTRACTS, erc20Abi, stakingVaultV2Abi } from '../config/contracts';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { TokenIcon } from './TokenIcon';

const TIERS = [
  { id: 0, label: 'Flexible', sublabel: 'No lock' },
  { id: 1, label: 'Growth', sublabel: '6 months lock' },
  { id: 2, label: 'Diamond', sublabel: '12 months lock' },
];

type Asset = 'USDC' | 'EURC';

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
  if (/allowance/i.test(message)) return 'Approval is too low for this stake amount.';
  if (/balance|exceeds balance/i.test(message)) return 'Your wallet balance is too low.';
  if (/paused/i.test(message)) return 'Staking is temporarily paused.';
  return message;
}

interface AssetSnapshot {
  account: `0x${string}`;
  asset: Asset;
  balance: bigint;
  allowance: bigint;
}

interface ApprovalIntent {
  asset: Asset;
  amount: bigint;
}

interface StakeDrawerProps {
  open: boolean;
  onClose: () => void;
  onTransactionConfirmed?: (stake: { asset: Asset; amount: bigint }) => void | Promise<void>;
}

export function StakeDrawer({
  open,
  onClose,
  onTransactionConfirmed,
}: StakeDrawerProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const refreshProtocolData = useRefreshProtocolData();
  const syncedStakeHash = useRef<`0x${string}` | undefined>(undefined);
  const [asset, setAsset] = useState<Asset>('USDC');
  const [tier, setTier] = useState(0);
  const [amount, setAmount] = useState('');
  const [snapshot, setSnapshot] = useState<AssetSnapshot | null>(null);
  const [readIssue, setReadIssue] = useState<string | null>(null);
  const [pendingApprovalIntent, setPendingApprovalIntent] = useState<ApprovalIntent | null>(null);
  const [approvedIntent, setApprovedIntent] = useState<ApprovalIntent | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const amountWei = parseTokenAmount(amount);

  const {
    isFetching: readsFetching,
    refetch: refetchReads,
  } = useReadContracts({
    contracts: address
      ? [
          { address: assetAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
          { address: assetAddress, abi: erc20Abi, functionName: 'allowance', args: [address, V2_CONTRACTS.stakingVault] },
        ]
      : [],
    allowFailure: false,
    // Reads are triggered explicitly so a response for USDC can never be
    // displayed as EURC while the user is switching assets.
    query: { enabled: false, retry: 2 },
  });

  const approveWrite = useWriteContract();
  const approveTx = useWaitForTransactionReceipt({ hash: approveWrite.data });

  const stakeWrite = useWriteContract();
  const stakeTx = useWaitForTransactionReceipt({ hash: stakeWrite.data });

  const refreshAssetState = useCallback(async () => {
    if (!address || !open) return;

    const requestedAsset = asset;
    const requestedAccount = address;
    setSnapshot(null);
    setReadIssue(null);

    const result = await refetchReads();
    const balance = result.data?.[0] as bigint | undefined;
    const allowance = result.data?.[1] as bigint | undefined;

    if (balance === undefined || allowance === undefined || result.error) {
      setReadIssue(`Unable to read ${requestedAsset} balance and allowance from Arc.`);
      return;
    }

    setSnapshot({
      account: requestedAccount,
      asset: requestedAsset,
      balance,
      allowance,
    });
  }, [address, asset, open, refetchReads]);

  const currentSnapshot =
    snapshot?.asset === asset && snapshot.account === address ? snapshot : null;
  const balance = currentSnapshot?.balance;
  const allowance = currentSnapshot?.allowance;
  const readsReady = balance !== undefined && allowance !== undefined;
  const allowanceReady = readsReady && amountWei > 0n && allowance >= amountWei;
  const isValidAmount = readsReady && amountWei > 0n && amountWei <= balance;
  const approvedInCurrentFlow = approvedIntent?.asset === asset && approvedIntent.amount === amountWei;
  const approvedForCurrentAmount = allowanceReady || approvedInCurrentFlow;
  const approvalVerified = allowanceReady;
  const stakeSuccess = stakeTx.isSuccess;
  const isBusy = approveWrite.isPending || approveTx.isLoading || stakeWrite.isPending || stakeTx.isLoading;
  const visibleError = transactionError
    ?? (approveWrite.error ? transactionErrorMessage(approveWrite.error) : null)
    ?? (approveTx.error ? transactionErrorMessage(approveTx.error) : null)
    ?? (stakeWrite.error ? transactionErrorMessage(stakeWrite.error) : null)
    ?? (stakeTx.error ? transactionErrorMessage(stakeTx.error) : null);

  useEffect(() => {
    if (!open) {
      setAmount('');
      setTier(0);
      setSnapshot(null);
      setReadIssue(null);
      setPendingApprovalIntent(null);
      setApprovedIntent(null);
      setTransactionError(null);
      stakeWrite.reset();
      approveWrite.reset();
      return;
    }

    setAmount('');
    setSnapshot(null);
    setReadIssue(null);
    setPendingApprovalIntent(null);
    setApprovedIntent(null);
    setTransactionError(null);
    stakeWrite.reset();
    approveWrite.reset();
    void refreshAssetState();
    // The transaction objects expose stable reset functions, but including
    // the objects themselves would retrigger this flow after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, open, refreshAssetState]);

  useEffect(() => {
    if (!approveTx.isSuccess || !pendingApprovalIntent) return;
    setApprovedIntent(pendingApprovalIntent);
    setPendingApprovalIntent(null);
    void refreshAssetState();
  }, [approveTx.isSuccess, pendingApprovalIntent, refreshAssetState]);

  useEffect(() => {
    const hash = stakeWrite.data;
    if (!stakeTx.isSuccess || !hash || syncedStakeHash.current === hash) return;

    syncedStakeHash.current = hash;
    const confirmedStake = { asset, amount: amountWei };
    // A confirmed stake is the end of this flow. Close immediately so the
    // drawer exits smoothly instead of briefly rendering a success state while
    // the dashboard queries are refreshing in the background.
    onClose();
    void Promise.resolve(
      onTransactionConfirmed
        ? onTransactionConfirmed(confirmedStake)
        : refreshProtocolData(),
    );
  }, [
    amountWei,
    asset,
    onTransactionConfirmed,
    onClose,
    refreshProtocolData,
    stakeTx.isSuccess,
    stakeWrite.data,
  ]);

  const updateAmount = (nextAmount: string) => {
    if (nextAmount && !/^\d*(?:\.\d{0,6})?$/.test(nextAmount)) return;
    setAmount(nextAmount);
    setTransactionError(null);
    setPendingApprovalIntent(null);
    setApprovedIntent(null);
    approveWrite.reset();
    stakeWrite.reset();
  };

  const handleApprove = async () => {
    if (!isValidAmount || !address || !publicClient || isBusy) return;

    setTransactionError(null);
    setPendingApprovalIntent({ asset, amount: amountWei });
    setApprovedIntent(null);
    try {
      const { request } = await publicClient.simulateContract({
        account: address,
        address: assetAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [V2_CONTRACTS.stakingVault, amountWei],
      });
      await approveWrite.writeContractAsync(request);
    } catch (error) {
      setPendingApprovalIntent(null);
      setTransactionError(transactionErrorMessage(error));
    }
  };

  const handleStake = async () => {
    if (!isValidAmount || !approvalVerified || !address || !publicClient || isBusy) return;

    setTransactionError(null);
    try {
      // Never trust only the cached allowance rendered by the drawer. Arc RPC
      // nodes can briefly serve a pre-approval state after the receipt has
      // landed, which otherwise makes the next simulation fail and leaves the
      // user looking at a misleading "Staking…" state.
      const confirmedAllowance = await publicClient.readContract({
        address: assetAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, V2_CONTRACTS.stakingVault],
      });
      if (confirmedAllowance < amountWei) {
        setSnapshot((current) => current && current.asset === asset && current.account === address
          ? { ...current, allowance: confirmedAllowance }
          : current);
        setApprovedIntent(null);
        setTransactionError('Approval is still syncing on Arc. Please approve once more in a moment.');
        return;
      }
      const { request } = await publicClient.simulateContract({
        account: address,
        address: V2_CONTRACTS.stakingVault,
        abi: stakingVaultV2Abi,
        functionName: 'stake',
        args: [assetAddress, amountWei, tier],
      });
      await stakeWrite.writeContractAsync(request);
    } catch (error) {
      setTransactionError(transactionErrorMessage(error));
    }
  };

  const handleClose = () => {
    if (!isBusy) onClose();
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
          />
          <motion.div
            className="drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className="drawer-header">
              <h3>Stake</h3>
              <button className="drawer-close" onClick={handleClose} aria-label="Close stake drawer" disabled={isBusy}>×</button>
            </div>

            {stakeSuccess ? (
              <div className="drawer-success">
                <span className="drawer-success__icon">✓</span>
                <p>Stake successful!</p>
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
                  <label>Asset</label>
                  <div className="asset-toggle">
                    {(['USDC', 'EURC'] as Asset[]).map((item) => (
                      <button
                        key={item}
                        className={`asset-toggle__btn ${asset === item ? 'asset-toggle__btn--active' : ''}`}
                        onClick={() => setAsset(item)}
                        disabled={readsFetching && asset !== item}
                      >
                        <TokenIcon symbol={item} size={20} />
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="drawer-field">
                  <label>Vault Tier</label>
                  <div className="tier-toggle">
                    {TIERS.map((item) => (
                      <button
                        key={item.id}
                        className={`tier-toggle__btn ${tier === item.id ? 'tier-toggle__btn--active' : ''}`}
                        onClick={() => setTier(item.id)}
                      >
                        <span className="tier-toggle__label">{item.label}</span>
                        <span className="tier-toggle__sublabel">{item.sublabel}</span>
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
                      onChange={(event) => updateAmount(event.target.value)}
                    />
                    <button
                      className="drawer-max-btn"
                      onClick={() => {
                        if (balance !== undefined) updateAmount(formatUnits(balance, 6));
                      }}
                      disabled={!readsReady}
                    >
                      MAX
                    </button>
                  </div>
                  <span className="text-secondary" style={{ fontSize: '0.78rem' }}>
                    {readsReady
                      ? `Balance: ${Number(formatUnits(balance, 6)).toFixed(4)} ${asset}`
                      : readsFetching
                        ? `Reading ${asset} balance...`
                        : `Balance unavailable`}
                  </span>
                </div>

                {readIssue && (
                  <div className="stake-read-error">
                    <span>{readIssue}</span>
                    <button type="button" onClick={() => void refreshAssetState()}>Retry</button>
                  </div>
                )}

                {visibleError && (
                  <div className="stake-read-error" role="alert">
                    <span>{visibleError}</span>
                    <button type="button" onClick={() => setTransactionError(null)}>Dismiss</button>
                  </div>
                )}

                {readsReady && amountWei > balance && (
                  <p style={{ color: 'var(--color-danger, #E5484D)', fontSize: '0.82rem' }}>
                    Insufficient balance.
                  </p>
                )}

                <div className="drawer-actions">
                  {!readsReady ? (
                    <button
                      className="cta-button"
                      disabled={readsFetching}
                      onClick={() => void refreshAssetState()}
                    >
                      {readsFetching ? 'Checking balance and allowance...' : 'Retry balance check'}
                    </button>
                  ) : amountWei === 0n ? (
                    <button className="cta-button" disabled>
                      Enter an amount
                    </button>
                  ) : !approvedForCurrentAmount ? (
                    <button
                      className="cta-button"
                      disabled={!isValidAmount || approveWrite.isPending || approveTx.isLoading}
                      onClick={() => void handleApprove()}
                    >
                      {approveWrite.isPending
                        ? 'Confirm approval in wallet...'
                        : approveTx.isLoading
                          ? 'Approving...'
                          : `Approve ${asset}`}
                    </button>
                  ) : !allowanceReady ? (
                    <button
                      className="cta-button"
                      disabled={readsFetching}
                      onClick={() => void refreshAssetState()}
                    >
                      {readsFetching ? 'Verifying approval...' : 'Verify approval'}
                    </button>
                  ) : (
                    <button
                      className="cta-button"
                      disabled={!isValidAmount || !approvalVerified || stakeWrite.isPending || stakeTx.isLoading}
                      onClick={() => void handleStake()}
                    >
                      {stakeWrite.isPending
                        ? 'Confirm stake in wallet...'
                        : stakeTx.isLoading
                          ? 'Staking...'
                          : `Stake ${asset}`}
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
