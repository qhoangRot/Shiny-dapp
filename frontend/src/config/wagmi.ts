import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';

// Dinh nghia mang Arc Testnet (chua co san trong wagmi/viem, phai tu khai bao)
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 18, // USDC la native gas token tren Arc, dung 18 decimals o dang native
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

export const config = getDefaultConfig({
  appName: 'Shiny Protocol',
  projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // se thay o buoc sau
  chains: [arcTestnet],
  ssr: false,
});