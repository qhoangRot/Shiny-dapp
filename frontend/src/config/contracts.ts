export const CONTRACTS = {
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  stakingVault: '0xD805A91b9B9633ba55f4FD8A2ee70D9479CC6e36',
  lendingPool: '0x770c247f114d2e1c8d28ef5eb5f2c12f6fc65e4d',
  priceOracle: '0x6331632c765de32db56ee2eeedde4eb24a978d71',
  rewardDistributor: '0xef6da2daec8f2daf3ff0274a214cfb9eeb4374f2',
} as const;

// The application uses this deployed Shiny stack for all live protocol flows.
// The historical addresses above remain only as source reference for the retired V1 code.
export const V2_CONTRACTS = {
  stakingVault: '0xD54C8e3D5BEf1E504719F6a0047547FC0De97926',
  oracleAdapter: '0x7F542B48a822959C0A08f1be676A889f0c592Eae',
  revenueRouter: '0x881ae2c48A177763A19552604615Eb65690582cf',
  insuranceFund: '0x20BE326f887f7552aA674F4734db872d5E2DD211',
  lendingPool: '0xADE5a9b19e9aFc204F571f9c9FbE00620cCE5896',
} as const;

// Historical deployment metadata. It is not used by the live application.
export const PROTOCOLS = {
  v1: {
    deployment: 'v1' as const,
    label: 'Historical',
    stakingVault: CONTRACTS.stakingVault,
    lendingPool: CONTRACTS.lendingPool,
    oracle: CONTRACTS.priceOracle,
    rewardDistributor: CONTRACTS.rewardDistributor,
  },
  v2: {
    deployment: 'v2' as const,
    label: 'Shiny',
    stakingVault: V2_CONTRACTS.stakingVault,
    lendingPool: V2_CONTRACTS.lendingPool,
    oracle: V2_CONTRACTS.oracleAdapter,
    revenueRouter: V2_CONTRACTS.revenueRouter,
    insuranceFund: V2_CONTRACTS.insuranceFund,
  },
} as const;

function optionalContractAddress(value: string | undefined): `0x${string}` | undefined {
  return value
    && !/^0x0{40}$/i.test(value)
    && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? value as `0x${string}`
    : undefined;
}

export const REWARD_DISTRIBUTOR_ADDRESS = optionalContractAddress(
  import.meta.env.VITE_REWARD_DISTRIBUTOR_ADDRESS,
) ?? CONTRACTS.rewardDistributor;

export const TESTNET_ORACLE = {
  mode: 'manual',
  pair: 'EUR/USD',
  label: 'Simulated testnet price',
  initialPrice: 1.08,
  minPrice: 0.8,
  maxPrice: 1.5,
} as const;

export const TESTNET_LIQUIDITY_SEED = {
  USDC: 50,
  EURC: 50,
} as const;

export const stakingVaultAbi = [
  {
    type: 'function',
    name: 'rewardRatePerSecond',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'tierBoostBps',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint8' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getTotalStakedByUser',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'asset', type: 'address' },
    ],
    outputs: [{ name: 'total', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'stake',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ name: 'positionId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextPositionId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'tier', type: 'uint8' },
      { name: 'principal', type: 'uint256' },
      { name: 'startTime', type: 'uint256' },
      { name: 'unlockTime', type: 'uint256' },
      { name: 'lastAccrualTime', type: 'uint256' },
      { name: 'accruedReward', type: 'uint256' },
      { name: 'withdrawn', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'pendingReward',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimReward',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'emergencyWithdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pendingInsuranceFund',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'Staked',
    inputs: [
      { name: 'positionId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'asset', type: 'address', indexed: false },
      { name: 'tier', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'unlockTime', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const rewardDistributorAbi = [
  {
    type: 'function',
    name: 'reservedByAsset',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'pendingReward',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'claimReward',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'currentAnnualRateBps',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const lendingPoolAbi = [
  {
    type: 'function',
    name: 'collateralBalance',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'loans',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    outputs: [
      { name: 'principal', type: 'uint256' },
      { name: 'lastAccrualTime', type: 'uint256' },
      { name: 'accruedInterest', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'getHealthFactor',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxLtvBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'liquidationThresholdBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'liquidationBonusBps',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'borrowRatePerSecond',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'borrow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'repay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Repaid',
    anonymous: false,
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const priceOracleAbi = [
  {
    type: 'function',
    name: 'viewPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'price', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'maxStaleness',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;
export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const stakingVaultV2Abi = [
  { type: 'function', name: 'nextPositionId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalPrincipal', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalWeightedPrincipal', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'rewardReserve', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function', name: 'userPositionIds', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function', name: 'positions', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' }, { name: 'asset', type: 'address' }, { name: 'tier', type: 'uint8' },
      { name: 'principal', type: 'uint256' }, { name: 'stakedAt', type: 'uint256' }, { name: 'unlockTime', type: 'uint256' },
      { name: 'pendingReward', type: 'uint256' }, { name: 'rewardDebt', type: 'uint256' }, { name: 'withdrawn', type: 'bool' },
    ],
  },
  {
    type: 'function', name: 'pendingReward', stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'getTotalSeizablePrincipal', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }, { name: 'asset', type: 'address' }], outputs: [{ name: 'total', type: 'uint256' }],
  },
  {
    type: 'function', name: 'stake', stateMutability: 'nonpayable',
    inputs: [{ name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'tier', type: 'uint8' }], outputs: [{ name: 'positionId', type: 'uint256' }],
  },
  { type: 'function', name: 'claimReward', stateMutability: 'nonpayable', inputs: [{ name: 'positionId', type: 'uint256' }], outputs: [{ name: 'reward', type: 'uint256' }] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'positionId', type: 'uint256' }], outputs: [{ name: 'principal', type: 'uint256' }, { name: 'reward', type: 'uint256' }] },
  { type: 'function', name: 'emergencyWithdraw', stateMutability: 'nonpayable', inputs: [{ name: 'positionId', type: 'uint256' }], outputs: [{ name: 'principal', type: 'uint256' }, { name: 'reward', type: 'uint256' }] },
] as const;

export const lendingPoolV2Abi = [
  {
    type: 'function', name: 'loans', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }, { name: 'debtAsset', type: 'address' }],
    outputs: [{ name: 'principal', type: 'uint256' }, { name: 'accruedInterest', type: 'uint256' }, { name: 'lastAccrualTime', type: 'uint256' }, { name: 'active', type: 'bool' }],
  },
  {
    type: 'function', name: 'getCurrentDebt', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }, { name: 'debtAsset', type: 'address' }],
    outputs: [{ name: 'principal', type: 'uint256' }, { name: 'storedInterest', type: 'uint256' }, { name: 'pendingInterest', type: 'uint256' }],
  },
  { type: 'function', name: 'borrowRatePerSecond', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'maxLtvBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'liquidationThresholdBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'liquidationBonusBps', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'availableLiquidity', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'totalPerformingDebt', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'canBorrow', stateMutability: 'view', inputs: [{ name: 'collateralAsset', type: 'address' }, { name: 'debtAsset', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'isEligibleCollateralForDebt', stateMutability: 'view', inputs: [{ name: 'collateralAsset', type: 'address' }, { name: 'debtAsset', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'borrow', stateMutability: 'nonpayable', inputs: [{ name: 'collateralAsset', type: 'address' }, { name: 'debtAsset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'repay', stateMutability: 'nonpayable', inputs: [{ name: 'debtAsset', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: 'amountRepaid', type: 'uint256' }] },
] as const;

export const oracleAdapterV2Abi = [
  { type: 'function', name: 'isHealthy', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'lastAcceptedPrice', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'updatedAt', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'MAX_PRICE_AGE', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'getValidatedPrice', stateMutability: 'nonpayable', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: 'priceWad', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }] },
] as const;

export const insuranceFundV2Abi = [
  { type: 'function', name: 'availableInsurance', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;
