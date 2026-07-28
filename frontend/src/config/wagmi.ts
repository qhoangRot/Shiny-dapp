import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain, fallback, http } from 'viem';

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
    default: {
      http: [
        'https://rpc.blockdaemon.testnet.arc.network',
        'https://rpc.testnet.arc.network',
        'https://rpc.quicknode.testnet.arc.network',
        'https://rpc.drpc.testnet.arc.network',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
  testnet: true,
});

export const config = getDefaultConfig({
  appName: 'Shiny Protocol',
  projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // se thay o buoc sau
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: fallback([
      http('https://rpc.blockdaemon.testnet.arc.network'),
      http('https://rpc.testnet.arc.network'),
      http('https://rpc.quicknode.testnet.arc.network'),
      http('https://rpc.drpc.testnet.arc.network'),
    ]),
  },
  ssr: false,
});
