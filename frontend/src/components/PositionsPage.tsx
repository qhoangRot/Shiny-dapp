import { useCallback, useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { CONTRACTS } from '../config/contracts';
import { useV2Positions } from '../hooks/useV2Positions';
import { useV2PositionRewards } from '../hooks/useV2PositionRewards';
import { useV2Loans } from '../hooks/useV2Loans';
import { V2StakePositionRow } from './Dashboard';
import { InfoTip } from './InfoTip';
import { V2RepayDrawer } from './V2RepayDrawer';
import { TokenIcon } from './TokenIcon';

type PositionTab = 'stakes' | 'borrows';
type AssetFilter = 'all' | 'USDC' | 'EURC';
type SortMode = 'newest' | 'reward' | 'unlock';

function tokenSymbol(asset: string): 'USDC' | 'EURC' {
  return asset.toLowerCase() === CONTRACTS.usdc.toLowerCase() ? 'USDC' : 'EURC';
}

export function PositionsPage() {
  const { positions: v2Positions, isLoading: v2Loading, refetch: refetchV2 } = useV2Positions();
  const { getReward: getV2Reward, refetchRewards: refetchV2Rewards } = useV2PositionRewards(v2Positions);
  const [tab, setTab] = useState<PositionTab>('stakes');
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [selectedRepayAsset, setSelectedRepayAsset] = useState<'USDC' | 'EURC' | null>(null);
  const v2LoansState = useV2Loans(selectedRepayAsset === null);

  const refreshAfterRepay = useCallback(async () => {
    await Promise.all([
      refetchV2(), refetchV2Rewards(), v2LoansState.refetch(),
    ]);
  }, [refetchV2, refetchV2Rewards, v2LoansState]);

  const visibleV2Positions = useMemo(() => {
    const filtered = assetFilter === 'all'
      ? v2Positions
      : v2Positions.filter((position) => tokenSymbol(position.asset) === assetFilter);

    return [...filtered].sort((a, b) => {
      if (sortMode === 'reward') {
        const aReward = getV2Reward(a).amount;
        const bReward = getV2Reward(b).amount;
        return aReward > bReward ? -1 : aReward < bReward ? 1 : 0;
      }
      if (sortMode === 'unlock') {
        const aUnlock = a.unlockTime === 0n ? BigInt(Number.MAX_SAFE_INTEGER) : a.unlockTime;
        const bUnlock = b.unlockTime === 0n ? BigInt(Number.MAX_SAFE_INTEGER) : b.unlockTime;
        return aUnlock < bUnlock ? -1 : aUnlock > bUnlock ? 1 : 0;
      }
      return a.startTime > b.startTime ? -1 : a.startTime < b.startTime ? 1 : 0;
    });
  }, [assetFilter, getV2Reward, sortMode, v2Positions]);

  const allLoans = v2LoansState.loans.map((loan) => ({
    symbol: loan.asset,
    principal: loan.principal,
    interest: loan.storedInterest + loan.pendingInterest,
    debt: loan.debt,
    active: loan.active,
  }));

  return (
    <section className="protocol-page">
      <div className="protocol-page__heading">
        <div>
          <span className="section-eyebrow">Portfolio</span>
          <h2>My Positions</h2>
          <p className="text-secondary">Review every active stake and borrow position in one place.</p>
        </div>
        <span className="position-count">{v2Positions.length} active stake{v2Positions.length === 1 ? '' : 's'}</span>
      </div>

      <div className="page-tabs" role="tablist" aria-label="Position type">
        <button className={tab === 'stakes' ? 'active' : ''} onClick={() => setTab('stakes')} role="tab">
          Stakes <span>{v2Positions.length}</span>
        </button>
        <button className={tab === 'borrows' ? 'active' : ''} onClick={() => setTab('borrows')} role="tab">
          Borrows <span>{allLoans.length}</span>
        </button>
      </div>

      {tab === 'stakes' ? (
        <>
          <div className="positions-toolbar">
            <label>
              Asset
              <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value as AssetFilter)}>
                <option value="all">All assets</option>
                <option value="USDC">USDC</option>
                <option value="EURC">EURC</option>
              </select>
            </label>
            <label>
              Sort
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                <option value="newest">Newest</option>
                <option value="reward">Highest reward</option>
                <option value="unlock">Unlock soonest</option>
              </select>
            </label>
          </div>

          <div className="protocol-table-card glass-panel">
            {v2Loading ? (
              <div className="page-empty-state">Loading your staking positions...</div>
            ) : visibleV2Positions.length === 0 ? (
              <div className="page-empty-state">
                <strong>No matching positions</strong>
                <span>Try another asset filter or open a new stake from Markets.</span>
              </div>
            ) : (
              <table className="protocol-table positions-detail-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Vault</th>
                    <th className="numeric-cell">Principal</th>
                    <th className="numeric-cell">
                      Claimable reward
                      <InfoTip text="Claimable rewards come from a separately funded testnet program, are paid in the staked token, and refresh about every 5 seconds." />
                    </th>
                    <th>
                      Lock status
                      <InfoTip text="Flexible positions are unlocked immediately. Growth and Diamond positions unlock after their fixed term." />
                    </th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleV2Positions.map((position) => (
                    <V2StakePositionRow key={`v2-${position.id}`} position={position} reward={getV2Reward(position)} onDone={refetchV2} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="protocol-table-card glass-panel">
          {v2LoansState.isLoading ? (
            <div className="page-empty-state">Loading your borrow positions...</div>
          ) : allLoans.length === 0 ? (
            <div className="page-empty-state">
              <strong>No active borrows</strong>
              <span>Your staked assets can be used as collateral from the Markets page.</span>
            </div>
          ) : (
            <table className="protocol-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="numeric-cell">Principal</th>
                  <th className="numeric-cell">Accrued interest</th>
                  <th className="numeric-cell">Current debt</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {allLoans.map((loan) => (
                  <tr key={loan.symbol}>
                    <td><span className="asset-with-icon"><TokenIcon symbol={loan.symbol} size={28} />{loan.symbol}</span></td>
                    <td className="numeric-cell">{Number(formatUnits(loan.principal, 6)).toFixed(2)}</td>
                    <td className="numeric-cell">{Number(formatUnits(loan.interest, 6)).toFixed(4)}</td>
                    <td className="numeric-cell">{Number(formatUnits(loan.debt, 6)).toFixed(4)} {loan.symbol}</td>
                    <td><span className="status-pill status-pill--active">Active</span></td>
                    <td className="position-actions-cell">
                      <button
                        className="row-action-btn"
                        type="button"
                        disabled={loan.debt === 0n}
                        aria-label={`Repay ${loan.symbol}`}
                        onClick={() => setSelectedRepayAsset(loan.symbol)}
                      >
                        Repay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <V2RepayDrawer
        open={selectedRepayAsset !== null}
        asset={selectedRepayAsset ?? 'USDC'}
        onClose={() => setSelectedRepayAsset(null)}
        onTransactionConfirmed={refreshAfterRepay}
      />
    </section>
  );
}
