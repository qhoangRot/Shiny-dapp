export function useRewardRates() {
  return {
    // V2 rewards are funded by settled borrow interest rather than a fixed APR.
    getAnnualRateBps: (_asset: string, _tier: number) => 0n,
    hasActiveProgram: true,
    isConfigured: true,
    isLoading: false,
    isError: false,
    refetch: async () => undefined,
  };
}
