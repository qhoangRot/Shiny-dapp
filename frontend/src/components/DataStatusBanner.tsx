export function DataStatusBanner({
  stale,
  refreshing,
  onRefresh,
}: {
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (!stale) return null;

  return (
    <div className="data-status-banner" role="status">
      <span className="data-status-banner__icon">!</span>
      <span>
        Unable to fetch the latest on-chain data. Displaying the last synced data.
      </span>
      <button type="button" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
