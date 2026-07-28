import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useRefreshProtocolData() {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['readContract'] }),
      queryClient.invalidateQueries({ queryKey: ['readContracts'] }),
    ]);
  }, [queryClient]);
}
