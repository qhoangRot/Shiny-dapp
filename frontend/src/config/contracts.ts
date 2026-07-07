export const CONTRACTS = {
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec069B5F319D72a',
  stakingVault: '0xD805A91b9B9633ba55f4FD8A2ee70D9479CC6e36',
  lendingPool: '0xB7D87260DaD3858AEC7BE113B8da92dDe74e7c63',
  priceOracle: '0xacd441a57Df93A6b028788357de426682227970C',
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
] as const;