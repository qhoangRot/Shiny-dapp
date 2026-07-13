import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseUnits, formatUnits } from 'viem';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACTS, stakingVaultAbi, erc20Abi } from '../config/contracts';
import { TokenIcon } from './TokenIcon';

const TIERS = [
  { id: 0, label: 'Flexible', sublabel: 'No lock' },
  { id: 1, label: 'Growth', sublabel: '6 months lock' },
  { id: 2, label: 'Diamond', sublabel: '12 months lock' },
];

type Asset = 'USDC' | 'EURC';

export function StakeDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const [asset, setAsset] = useState<Asset>('USDC');
  const [tier, setTier] = useState(0);
  const [amount, setAmount] = useState('');

  const assetAddress = asset === 'USDC' ? CONTRACTS.usdc : CONTRACTS.eurc;
  const amountWei = amount && !isNaN(Number(amount)) ? parseUnits(amount, 6) : 0n;

  const { data: readData, refetch: refetchReads } = useReadContracts({
    contracts: address
      ? [
          { address: assetAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
          { address: assetAddress, abi: erc20Abi, functionName: 'allowance', args: [address, CONTRACTS.stakingVault] },
        ]
      : [],
    query: { enabled: !!address && open },
  });

  const balance = (readData?.[0]?.result as bigint) ?? 0n;
  const allowance = (readData?.[1]?.result as bigint) ?? 0n;
  const needsApproval = amountWei > 0n && allowance < amountWei;

  const approveWrite = useWriteContract();
  const approveTx = useWaitForTransactionReceipt({ hash: approveWrite.data });

  const stakeWrite = useWriteContract();
  const stakeTx = useWaitForTransactionReceipt({ hash: stakeWrite.data });

  useEffect(() => {
    if (approveTx.isSuccess) refetchReads();
  }, [approveTx.isSuccess, refetchReads]);

  useEffect(() => {
    if (!open) {
      setAmount('');
      setTier(0);
      stakeWrite.reset();
      approveWrite.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleApprove = () => {
    approveWrite.writeContract({
      address: assetAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [CONTRACTS.stakingVault, amountWei],
    });
  };

  const handleStake = () => {
    stakeWrite.writeContract({
      address: CONTRACTS.stakingVault,
      abi: stakingVaultAbi,
      functionName: 'stake',
      args: [assetAddress, amountWei, tier],
    });
  };

  const isValidAmount = amountWei > 0n && amountWei <= balance;
  const stakeSuccess = stakeTx.isSuccess;

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
              <button className="drawer-close" onClick={onClose}>×</button>
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
                  <label>Vault Tier</label>
                  <div className="tier-toggle">
                    {TIERS.map((t) => (
                      <button
                        key={t.id}
                        className={`tier-toggle__btn ${tier === t.id ? 'tier-toggle__btn--active' : ''}`}
                        onClick={() => setTier(t.id)}
                      >
                        <span className="tier-toggle__label">{t.label}</span>
                        <span className="tier-toggle__sublabel">{t.sublabel}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="drawer-field">
                  <label>Amount</label>
                  <div className="drawer-amount-input">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <button
                      className="drawer-max-btn"
                      onClick={() => setAmount(formatUnits(balance, 6))}
                    >
                      MAX
                    </button>
                  </div>
                  <span className="text-secondary" style={{ fontSize: '0.78rem' }}>
                    Balance: {Number(formatUnits(balance, 6)).toFixed(4)} {asset}
                  </span>
                </div>

                {amountWei > 0n && !isValidAmount && (
                  <p style={{ color: 'var(--color-danger, #E5484D)', fontSize: '0.82rem' }}>
                    Insufficient balance.
                  </p>
                )}

                <div className="drawer-actions">
                  {needsApproval ? (
                    <button
                      className="cta-button"
                      disabled={!isValidAmount || approveWrite.isPending || approveTx.isLoading}
                      onClick={handleApprove}
                    >
                      {approveWrite.isPending
                        ? 'Confirm in wallet…'
                        : approveTx.isLoading
                        ? 'Approving…'
                        : `Approve ${asset}`}
                    </button>
                  ) : (
                    <button
                      className="cta-button"
                      disabled={!isValidAmount || stakeWrite.isPending || stakeTx.isLoading}
                      onClick={handleStake}
                    >
                      {stakeWrite.isPending
                        ? 'Confirm in wallet…'
                        : stakeTx.isLoading
                        ? 'Staking…'
                        : 'Stake'}
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
