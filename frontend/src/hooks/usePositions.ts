import { useCallback, useEffect, useState } from 'react';
import { useAccount, usePublicClient, useReadContracts } from 'wagmi';
import { CONTRACTS, stakingVaultAbi } from '../config/contracts';

// Block luc StakingVault duoc deploy (theo thu tu DeployAll.s.sol: PriceOracle -> StakingVault -> LendingPool).
// Quet event log tu block nay thay vi block 0, vi RPC Arc Testnet gioi han eth_getLogs toi da 10,000 block/lan.
const DEPLOY_BLOCK = 50285624n;

export interface StakePosition {
  id: bigint;
  owner: `0x${string}`;
  asset: `0x${string}`;
  tier: number;
  principal: bigint;
  startTime: bigint;
  unlockTime: bigint;
  lastAccrualTime: bigint;
  accruedReward: bigint;
  withdrawn: boolean;
  pendingReward: bigint;
}

const STAKED_EVENT = {
  type: 'event' as const,
  name: 'Staked' as const,
  inputs: [
    { name: 'positionId', type: 'uint256', indexed: true },
    { name: 'user', type: 'address', indexed: true },
    { name: 'asset', type: 'address', indexed: false },
    { name: 'tier', type: 'uint8', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'unlockTime', type: 'uint256', indexed: false },
  ],
};

export function usePositions() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [positionIds, setPositionIds] = useState<bigint[]>([]);
  const [loadingIds, setLoadingIds] = useState(true);

  const fetchIds = useCallback(async () => {
    if (!address || !publicClient) {
      setPositionIds([]);
      setLoadingIds(false);
      return;
    }
    setLoadingIds(true);
    try {
      const currentBlock = await publicClient.getBlockNumber();
      const CHUNK_SIZE = 9_000n;
      const MAX_LOOKBACK_BLOCKS = 200_000n;
      const scanStart =
        currentBlock - DEPLOY_BLOCK > MAX_LOOKBACK_BLOCKS
          ? currentBlock - MAX_LOOKBACK_BLOCKS
          : DEPLOY_BLOCK;

      const ranges: { from: bigint; to: bigint }[] = [];
      let from = scanStart;
      while (from <= currentBlock) {
        const to = from + CHUNK_SIZE > currentBlock ? currentBlock : from + CHUNK_SIZE;
        ranges.push({ from, to });
        from = to + 1n;
      }

      const results = await Promise.all(
        ranges.map((r) =>
          publicClient.getLogs({
            address: CONTRACTS.stakingVault,
            event: STAKED_EVENT,
            args: { user: address },
            fromBlock: r.from,
            toBlock: r.to,
          })
        )
      );
      const allLogs = results.flat();
      const ids = allLogs.map((log) => (log.args as { positionId: bigint }).positionId);
      setPositionIds(ids);
    } catch (err) {
      console.error('Loi khi lay danh sach position tu event log:', err);
      setPositionIds([]);
    } finally {
      setLoadingIds(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    fetchIds();
  }, [fetchIds]);

  const { data, isLoading: loadingDetails, refetch: refetchDetails } = useReadContracts({
    contracts: positionIds.flatMap((id) => [
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'positions', args: [id] },
      { address: CONTRACTS.stakingVault, abi: stakingVaultAbi, functionName: 'pendingReward', args: [id] },
    ]),
    query: { enabled: positionIds.length > 0, refetchInterval: 15_000 },
  });

  const positions: StakePosition[] = [];
  if (data) {
    for (let i = 0; i < positionIds.length; i++) {
      const posResult = data[i * 2]?.result as
        | [`0x${string}`, `0x${string}`, number, bigint, bigint, bigint, bigint, bigint, boolean]
        | undefined;
      const rewardResult = data[i * 2 + 1]?.result as bigint | undefined;
      if (!posResult) continue;

      const [owner, asset, tier, principal, startTime, unlockTime, lastAccrualTime, accruedReward, withdrawn] =
        posResult;

      if (withdrawn) continue;

      positions.push({
        id: positionIds[i],
        owner,
        asset,
        tier,
        principal,
        startTime,
        unlockTime,
        lastAccrualTime,
        accruedReward,
        withdrawn,
        pendingReward: rewardResult ?? 0n,
      });
    }
  }

  // refetch "day du": quet lai event log de tim ID moi, ROI moi refetch chi tiet.
  const refetch = useCallback(async () => {
    await fetchIds();
    await refetchDetails();
  }, [fetchIds, refetchDetails]);

  return {
    positions,
    isLoading: loadingIds || loadingDetails,
    refetch,
  };
}
