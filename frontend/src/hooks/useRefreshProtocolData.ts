import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useRefreshProtocolData() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    // Invalidate first so cached reads cannot be reused, then actively refetch
    // visible queries. This is important after a confirmed transaction: a
    // background refetch alone can leave dashboard totals stale until the next
    // polling interval.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['readContract'] }),
      queryClient.invalidateQueries({ queryKey: ['readContracts'] }),
    ]);

    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['readContract'], type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['readContracts'], type: 'active' }),
    ]);
  }, [queryClient]);
}
