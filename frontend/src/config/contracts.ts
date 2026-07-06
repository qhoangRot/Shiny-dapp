export const CONTRACTS = {
  usdc: '0x3600000000000000000000000000000000000000',
  eurc: '0x89B50855Aa3bE2F677cD6303Cec069B5F319D72a',
  stakingVault: '0xD805A91b9B9633ba55f4FD8A2ee70D9479CC6e36',
  lendingPool: '0xB7D87260DaD3858AEC7BE113B8da92dDe74e7c63',
  priceOracle: '0xacd441a57Df93A6b028788357de426682227970C',
} as const;

// Chi lay dung phan ham can dung, khong can copy toan bo ABI day du
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
] as const;