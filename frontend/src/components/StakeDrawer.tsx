import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatUnits, parseUnits } from 'viem';
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { CONTRACTS, erc20Abi, stakingVaultAbi } from '../config/contracts';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { TokenIcon } from './TokenIcon';

const TIERS = [
  { id: 0, label: 'Flexible', sublabel: 'No lock' },
  { id: 1, label: 'Growth', sublabel: '6 months lock' },
  { id: 2, label: 'Diamond', sublabel: '12 months lock' },
];

type Asset = 'USDC' | 'EURC';

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
  onTransactionConfirmed?: () => void | Promise<void>;
}

export function StakeDrawer({
  open,
  onClose,
  onTransactionConfirmed,
}: StakeDrawerProps) {
  const { address } = useAccount();
  const refreshProtocolData = useRefreshProtocolData();
  const syncedStakeHash = useRef<`0x${string}` | undefined>(undefined);
  const [asset, setAsset] = useState<Asset>('USDC');
  const [tier, setTier] = useState(0);
  const [amount, setAmount] = useState('');
  const [snapshot, setSnapshot] = useState<AssetSnapshot | null>(null);
  const [readIssue, setReadIssue] = useState<string | null>(null);
  const [pendingApprovalIntent, setPendingApprovalIntent] = useState<ApprovalIntent | null>(null);
  const [approvedIntent, setApprovedIntent] = useState<ApprovalIntent | null>(null);

  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const amountWei = amount && !Number.isNaN(Number(amount)) ? parseUnits(amount, 6) : 0n;

  const {
    isFetching: readsFetching,
    refetch: refetchReads,
  } = useReadContracts({
    contracts: address
      ? [
          { address: assetAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
          { address: assetAddress, abi: erc20Abi, functionName: 'allowance', args: [address, CONTRACTS.stakingVault] },
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
  const approvedInCurrentFlow =
    approvedIntent?.asset === asset && approvedIntent.amount === amountWei;
  const exactOnchainApproval =
    readsReady && amountWei > 0n && allowance === amountWei;
  const approvedForCurrentAmount =
    approvedInCurrentFlow || exactOnchainApproval;
  const approvalVerified = approvedForCurrentAmount && allowanceReady;
  const stakeSuccess = stakeTx.isSuccess;

  useEffect(() => {
    if (!open) {
      setAmount('');
      setTier(0);
      setSnapshot(null);
      setReadIssue(null);
      setPendingApprovalIntent(null);
      setApprovedIntent(null);
      stakeWrite.reset();
      approveWrite.reset();
      return;
    }

    setAmount('');
    setSnapshot(null);
    setReadIssue(null);
    setPendingApprovalIntent(null);
    setApprovedIntent(null);
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
    void Promise.all([
      refreshProtocolData(),
      refreshAssetState(),
      Promise.resolve(onTransactionConfirmed?.()),
    ]);
  }, [
    onTransactionConfirmed,
    refreshAssetState,
    refreshProtocolData,
    stakeTx.isSuccess,
    stakeWrite.data,
  ]);

  const updateAmount = (nextAmount: string) => {
    setAmount(nextAmount);
    setPendingApprovalIntent(null);
    setApprovedIntent(null);
    approveWrite.reset();
    stakeWrite.reset();
  };

  const handleApprove = () => {
    if (!isValidAmount) return;

    setPendingApprovalIntent({ asset, amount: amountWei });
    setApprovedIntent(null);
    approveWrite.writeContract({
      address: assetAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [CONTRACTS.stakingVault, amountWei],
    });
  };

  const handleStake = () => {
    if (!isValidAmount || !approvalVerified) return;

    stakeWrite.writeContract({
      address: CONTRACTS.stakingVault,
      abi: stakingVaultAbi,
      functionName: 'stake',
      args: [assetAddress, amountWei, tier],
    });
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
            onClick={onClose}
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
              <button className="drawer-close" onClick={onClose} aria-label="Close stake drawer">×</button>
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
                      onClick={handleApprove}
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
                      onClick={handleStake}
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
