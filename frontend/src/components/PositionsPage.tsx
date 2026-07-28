import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { useAccount, useReadContracts } from 'wagmi';
import { CONTRACTS, lendingPoolAbi } from '../config/contracts';
import { usePositions } from '../hooks/usePositions';
import { usePositionRewards } from '../hooks/usePositionRewards';
import { useRefreshProtocolData } from '../hooks/useRefreshProtocolData';
import { StakePositionRow } from './Dashboard';
import { InfoTip } from './InfoTip';
import { RepayDrawer } from './RepayDrawer';
import { TokenIcon } from './TokenIcon';

type PositionTab = 'stakes' | 'borrows';
type AssetFilter = 'all' | 'USDC' | 'EURC';
type SortMode = 'newest' | 'reward' | 'unlock';

function tokenSymbol(asset: string): 'USDC' | 'EURC' {
  return asset.toLowerCase() === CONTRACTS.usdc.toLowerCase() ? 'USDC' : 'EURC';
}

export function PositionsPage() {
  const { address } = useAccount();
  const { positions, isLoading, refetch } = usePositions();
  const {
    getReward,
    isLoading: rewardsLoading,
    refreshAfterClaim,
  } = usePositionRewards(positions);
  const [tab, setTab] = useState<PositionTab>('stakes');
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [selectedRepayAsset, setSelectedRepayAsset] = useState<'USDC' | 'EURC' | null>(null);
  const refreshProtocolData = useRefreshProtocolData();
  const refreshRetryRef = useRef<number | null>(null);

  const {
    data: loanData,
    isLoading: loansLoading,
    refetch: refetchLoans,
  } = useReadContracts({
    contracts: address
      ? [
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.usdc] },
          { address: CONTRACTS.lendingPool, abi: lendingPoolAbi, functionName: 'loans', args: [address, CONTRACTS.eurc] },
        ]
      : [],
    query: {
      enabled: !!address,
      refetchInterval: selectedRepayAsset === null ? 30_000 : false,
    },
  });

  const refreshAfterRepay = useCallback(async () => {
    await Promise.all([
      refreshProtocolData(),
      refetchLoans(),
      refetch(),
    ]);

    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }

    refreshRetryRef.current = window.setTimeout(() => {
      void Promise.all([
        refetchLoans(),
        refetch(),
      ]);
      refreshRetryRef.current = null;
    }, 700);
  }, [refetch, refetchLoans, refreshProtocolData]);

  useEffect(() => () => {
    if (refreshRetryRef.current !== null) {
      window.clearTimeout(refreshRetryRef.current);
    }
  }, []);

  const visiblePositions = useMemo(() => {
    const filtered = assetFilter === 'all'
      ? [...positions]
      : positions.filter((position) => tokenSymbol(position.asset) === assetFilter);

    return filtered.sort((a, b) => {
      if (sortMode === 'reward') {
        const aReward = getReward(a.id).amount;
        const bReward = getReward(b.id).amount;
        if (aReward === bReward) return 0;
        return aReward > bReward ? -1 : 1;
      }
      if (sortMode === 'unlock') {
        const aUnlock = a.unlockTime === 0n ? 2n ** 255n : a.unlockTime;
        const bUnlock = b.unlockTime === 0n ? 2n ** 255n : b.unlockTime;
        if (aUnlock === bUnlock) return 0;
        return aUnlock < bUnlock ? -1 : 1;
      }
      if (a.startTime === b.startTime) return 0;
      return a.startTime > b.startTime ? -1 : 1;
    });
  }, [assetFilter, getReward, positions, sortMode]);

  const loans = [
    { symbol: 'USDC' as const, result: loanData?.[0]?.result },
    { symbol: 'EURC' as const, result: loanData?.[1]?.result },
  ]
    .map(({ symbol, result }) => {
      const loan = result as [bigint, bigint, bigint, boolean] | undefined;
      return {
        symbol,
        principal: loan?.[0] ?? 0n,
        interest: loan?.[2] ?? 0n,
        active: loan?.[3] ?? false,
        debt: (loan?.[0] ?? 0n) + (loan?.[2] ?? 0n),
      };
    })
    .filter((loan) => loan.active || loan.debt > 0n);

  return (
    <section className="protocol-page">
      <div className="protocol-page__heading">
        <div>
          <span className="section-eyebrow">Portfolio</span>
          <h2>My Positions</h2>
          <p className="text-secondary">Review every active stake and borrow position in one place.</p>
        </div>
        <span className="position-count">{positions.length} active stake{positions.length === 1 ? '' : 's'}</span>
      </div>

      <div className="page-tabs" role="tablist" aria-label="Position type">
        <button className={tab === 'stakes' ? 'active' : ''} onClick={() => setTab('stakes')} role="tab">
          Stakes <span>{positions.length}</span>
        </button>
        <button className={tab === 'borrows' ? 'active' : ''} onClick={() => setTab('borrows')} role="tab">
          Borrows <span>{loans.length}</span>
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
            {isLoading ? (
              <div className="page-empty-state">Loading your staking positions...</div>
            ) : visiblePositions.length === 0 ? (
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
                      <InfoTip text="Claimable rewards come from a separately funded testnet program, are paid in the staked token, and refresh about every 8 seconds." />
                    </th>
                    <th>
                      Lock status
                      <InfoTip text="Flexible positions are unlocked immediately. Growth and Diamond positions unlock after their fixed term." />
                    </th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {visiblePositions.map((position) => (
                    <StakePositionRow
                      key={position.id.toString()}
                      position={position}
                      reward={getReward(position.id)}
                      rewardsLoading={rewardsLoading}
                      onClaimDone={refreshAfterClaim}
                      onDone={refetch}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="protocol-table-card glass-panel">
          {loansLoading ? (
            <div className="page-empty-state">Loading your borrow positions...</div>
          ) : loans.length === 0 ? (
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
                {loans.map((loan) => (
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

      <RepayDrawer
        open={selectedRepayAsset !== null}
        asset={selectedRepayAsset ?? 'USDC'}
        onClose={() => setSelectedRepayAsset(null)}
        onTransactionConfirmed={refreshAfterRepay}
      />
    </section>
  );
}
