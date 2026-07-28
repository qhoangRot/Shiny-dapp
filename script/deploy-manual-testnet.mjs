import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

function readEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(rootDir, '.env'), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1).replace(/^["']|["']$/g, '');
        return [key, value];
      }),
  );
}

function resolveImport(importPath) {
  if (importPath.startsWith('@openzeppelin/contracts/')) {
    return path.join(
      rootDir,
      'lib',
      'openzeppelin-contracts',
      'contracts',
      importPath.slice('@openzeppelin/contracts/'.length),
    );
  }

  return path.join(rootDir, importPath);
}

function compileContracts() {
  const sourceFiles = [
    'src/oracle/ManualTestnetOracle.sol',
    'src/LendingPool.sol',
  ];
  const input = {
    language: 'Solidity',
    sources: Object.fromEntries(
      sourceFiles.map((sourcePath) => [
        sourcePath,
        { content: fs.readFileSync(path.join(rootDir, sourcePath), 'utf8') },
      ]),
    ),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath) => {
        const resolved = resolveImport(importPath);
        if (!fs.existsSync(resolved)) {
          return { error: `Import not found: ${importPath}` };
        }
        return { contents: fs.readFileSync(resolved, 'utf8') };
      },
    }),
  );

  const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));
  }

  return {
    manualOracle: output.contracts['src/oracle/ManualTestnetOracle.sol'].ManualTestnetOracle,
    lendingPool: output.contracts['src/LendingPool.sol'].LendingPool,
  };
}

const artifacts = compileContracts();
if (!process.argv.includes('--deploy')) {
  console.log('ManualTestnetOracle and LendingPool compiled successfully.');
  process.exit(0);
}

const env = readEnv();
const requiredKeys = ['PRIVATE_KEY', 'USDC_ADDRESS', 'EURC_ADDRESS', 'STAKING_VAULT_ADDRESS'];
for (const key of requiredKeys) {
  if (!env[key]) throw new Error(`Missing ${key} in .env`);
}

const account = privateKeyToAccount(env.PRIVATE_KEY);
const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.blockdaemon.testnet.arc.network',
        'https://rpc.testnet.arc.network',
        'https://rpc.quicknode.testnet.arc.network',
      ],
    },
  },
});
const transport = fallback(
  arcTestnet.rpcUrls.default.http.map((url) => http(url)),
);
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });

const ownerAbi = parseAbi(['function owner() view returns (address)']);
const vaultOwner = await publicClient.readContract({
  address: env.STAKING_VAULT_ADDRESS,
  abi: ownerAbi,
  functionName: 'owner',
});
if (vaultOwner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`Deployer ${account.address} is not the StakingVault owner.`);
}

async function deploy(artifact, args) {
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`Deployment failed: ${hash}`);
  }
  return receipt.contractAddress;
}

async function writeContract(parameters) {
  const hash = await walletClient.writeContract(parameters);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction failed: ${hash}`);
  return hash;
}

const initialPrice = parseUnits('1.08', 18);
const manualOracle = await deploy(artifacts.manualOracle, [account.address, initialPrice]);
const lendingPool = await deploy(artifacts.lendingPool, [
  account.address,
  env.USDC_ADDRESS,
  env.EURC_ADDRESS,
  manualOracle,
]);

const vaultAbi = parseAbi(['function setLendingPool(address lendingPoolAddress)']);
const poolAbi = parseAbi(['function setStakingVault(address stakingVaultAddress)']);
await writeContract({
  address: env.STAKING_VAULT_ADDRESS,
  abi: vaultAbi,
  functionName: 'setLendingPool',
  args: [lendingPool],
});
await writeContract({
  address: lendingPool,
  abi: poolAbi,
  functionName: 'setStakingVault',
  args: [env.STAKING_VAULT_ADDRESS],
});

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);
for (const token of [env.USDC_ADDRESS, env.EURC_ADDRESS]) {
  await writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [lendingPool, parseUnits('50', 6)],
  });
}

const oracleAbi = parseAbi(['function viewPrice() view returns (uint256 price, uint256 timestamp)']);
const [price, timestamp] = await publicClient.readContract({
  address: manualOracle,
  abi: oracleAbi,
  functionName: 'viewPrice',
});
const [usdcLiquidity, eurcLiquidity] = await Promise.all([
  publicClient.readContract({
    address: env.USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [lendingPool],
  }),
  publicClient.readContract({
    address: env.EURC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [lendingPool],
  }),
]);

console.log(
  JSON.stringify(
    {
      manualOracle,
      lendingPool,
      simulatedEurUsdPrice: formatUnits(price, 18),
      updatedAt: timestamp.toString(),
      liquidity: {
        USDC: formatUnits(usdcLiquidity, 6),
        EURC: formatUnits(eurcLiquidity, 6),
      },
    },
    null,
    2,
  ),
);
