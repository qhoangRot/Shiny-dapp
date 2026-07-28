/**
 * RewardDistributor deployment/configuration helper.
 *
 * Safe defaults:
 *   node script/deploy-reward-distributor.mjs
 *     Compiles only. It does not read PRIVATE_KEY, connect to RPC, or broadcast.
 *
 * Explicit deployment:
 *   node script/deploy-reward-distributor.mjs --deploy
 *     Deploys RewardDistributor only.
 *
 * Explicit deployment + two funded programs:
 *   node script/deploy-reward-distributor.mjs --deploy --configure
 *     Deploys, creates USDC/EURC programs, approves exact funding amounts,
 *     funds both programs, and verifies the resulting on-chain state.
 *
 * Funding values are raw token units. For a six-decimal token, 100 tokens is
 * 100000000 units. This script never prints PRIVATE_KEY or raw environment data.
 * Explicit process environment variables override matching values from .env.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  getAddress,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const args = new Set(process.argv.slice(2));
const knownArgs = new Set(['--deploy', '--configure', '--help']);

for (const argument of args) {
  if (!knownArgs.has(argument)) {
    throw new Error(`Unknown argument: ${argument}`);
  }
}

function printUsage() {
  console.log(`
RewardDistributor helper

  node script/deploy-reward-distributor.mjs
      Compile only (safe default).

  node script/deploy-reward-distributor.mjs --deploy
      Deploy only. Requires PRIVATE_KEY and STAKING_VAULT_ADDRESS.

  node script/deploy-reward-distributor.mjs --deploy --configure
      Deploy, create both programs, and fund them. Also requires:
      USDC_ADDRESS
      EURC_ADDRESS
      REWARD_PROGRAM_START
      REWARD_PROGRAM_END
      FLEXIBLE_ANNUAL_BPS
      GROWTH_ANNUAL_BPS
      DIAMOND_ANNUAL_BPS
      USDC_REWARD_FUNDING_UNITS
      EURC_REWARD_FUNDING_UNITS

Optional:
      ARC_TESTNET_RPC_URL

Rates are direct annual basis points: 500 = 5.00%.
Funding values are raw token units.
Process environment values override .env for one-run configuration.
`.trim());
}

if (args.has('--help')) {
  printUsage();
  process.exit(0);
}

if (args.has('--configure') && !args.has('--deploy')) {
  throw new Error('--configure is only accepted together with --deploy.');
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

function compileRewardDistributor() {
  const sourcePath = 'src/RewardDistributor.sol';
  const input = {
    language: 'Solidity',
    sources: {
      [sourcePath]: {
        content: fs.readFileSync(path.join(rootDir, sourcePath), 'utf8'),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
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

  const diagnostics = output.errors ?? [];
  const errors = diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    throw new Error(errors.map((entry) => entry.formattedMessage).join('\n'));
  }

  const artifact = output.contracts?.[sourcePath]?.RewardDistributor;
  if (!artifact?.evm?.bytecode?.object) {
    throw new Error('RewardDistributor compilation produced no deployment bytecode.');
  }

  return artifact;
}

const artifact = compileRewardDistributor();
const runtimeBytes = artifact.evm.deployedBytecode.object.length / 2;

if (!args.has('--deploy')) {
  console.log(`RewardDistributor compiled successfully (runtime ${runtimeBytes} bytes).`);
  console.log('Compile-only mode: no environment secrets read, no RPC call, no transaction broadcast.');
  process.exit(0);
}

function readEnv() {
  const envPath = path.join(rootDir, '.env');
  const fileValues = fs.existsSync(envPath)
    ? Object.fromEntries(
        fs
          .readFileSync(envPath, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
          .map((line) => {
            const separator = line.indexOf('=');
            if (separator <= 0) throw new Error('Invalid .env entry.');
            const key = line.slice(0, separator).trim();
            const value = line
              .slice(separator + 1)
              .trim()
              .replace(/^["']|["']$/g, '');
            return [key, value];
          }),
      )
    : {};

  // Explicit one-run process values override .env. Values are never printed.
  return { ...fileValues, ...process.env };
}

function requireEnv(env, keys) {
  for (const key of keys) {
    if (!env[key]) throw new Error(`Missing ${key} in process environment or .env`);
  }
}

function parseAddress(value, label) {
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${label} is not a valid address.`);
  }
}

function parseUnsignedInteger(value, label) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned base-10 integer.`);
  }
  return BigInt(value);
}

function parseAnnualBps(value, label) {
  const parsed = parseUnsignedInteger(value, label);
  if (parsed > 10_000n) {
    throw new Error(`${label} cannot exceed 10000 (100.00%).`);
  }
  return Number(parsed);
}

const vaultReadAbi = parseAbi([
  'function owner() view returns (address)',
  'function supportedAssets(address asset) view returns (bool)',
]);
const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const env = readEnv();
requireEnv(env, ['PRIVATE_KEY', 'STAKING_VAULT_ADDRESS']);

if (!/^0x[a-fA-F0-9]{64}$/.test(env.PRIVATE_KEY)) {
  throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed hex value.');
}

const account = privateKeyToAccount(env.PRIVATE_KEY);
const stakingVaultAddress = parseAddress(env.STAKING_VAULT_ADDRESS, 'STAKING_VAULT_ADDRESS');
let rewardConfiguration;

if (args.has('--configure')) {
  requireEnv(env, [
    'USDC_ADDRESS',
    'EURC_ADDRESS',
    'REWARD_PROGRAM_START',
    'REWARD_PROGRAM_END',
    'FLEXIBLE_ANNUAL_BPS',
    'GROWTH_ANNUAL_BPS',
    'DIAMOND_ANNUAL_BPS',
    'USDC_REWARD_FUNDING_UNITS',
    'EURC_REWARD_FUNDING_UNITS',
  ]);

  const usdcAddress = parseAddress(env.USDC_ADDRESS, 'USDC_ADDRESS');
  const eurcAddress = parseAddress(env.EURC_ADDRESS, 'EURC_ADDRESS');
  if (usdcAddress.toLowerCase() === eurcAddress.toLowerCase()) {
    throw new Error('USDC_ADDRESS and EURC_ADDRESS must be different.');
  }

  const startTime = parseUnsignedInteger(env.REWARD_PROGRAM_START, 'REWARD_PROGRAM_START');
  const endTime = parseUnsignedInteger(env.REWARD_PROGRAM_END, 'REWARD_PROGRAM_END');
  if (startTime > (2n ** 64n) - 1n || endTime > (2n ** 64n) - 1n) {
    throw new Error('Reward program timestamps must fit uint64.');
  }
  if (endTime <= startTime) {
    throw new Error('REWARD_PROGRAM_END must be later than REWARD_PROGRAM_START.');
  }

  const flexibleAnnualBps = parseAnnualBps(env.FLEXIBLE_ANNUAL_BPS, 'FLEXIBLE_ANNUAL_BPS');
  const growthAnnualBps = parseAnnualBps(env.GROWTH_ANNUAL_BPS, 'GROWTH_ANNUAL_BPS');
  const diamondAnnualBps = parseAnnualBps(env.DIAMOND_ANNUAL_BPS, 'DIAMOND_ANNUAL_BPS');
  if (
    flexibleAnnualBps > growthAnnualBps
    || growthAnnualBps > diamondAnnualBps
  ) {
    throw new Error('Annual BPS must satisfy Flexible <= Growth <= Diamond.');
  }
  if (diamondAnnualBps === 0) {
    throw new Error('At least one annual reward rate must be non-zero.');
  }

  const usdcFunding = parseUnsignedInteger(
    env.USDC_REWARD_FUNDING_UNITS,
    'USDC_REWARD_FUNDING_UNITS',
  );
  const eurcFunding = parseUnsignedInteger(
    env.EURC_REWARD_FUNDING_UNITS,
    'EURC_REWARD_FUNDING_UNITS',
  );
  if (usdcFunding === 0n || eurcFunding === 0n) {
    throw new Error('Both reward funding amounts must be non-zero.');
  }

  rewardConfiguration = {
    usdcAddress,
    eurcAddress,
    startTime,
    endTime,
    flexibleAnnualBps,
    growthAnnualBps,
    diamondAnnualBps,
    usdcFunding,
    eurcFunding,
  };
}

const defaultRpcUrls = [
  'https://rpc.blockdaemon.testnet.arc.network',
  'https://rpc.testnet.arc.network',
  'https://rpc.quicknode.testnet.arc.network',
];
const rpcUrls = [
  ...(env.ARC_TESTNET_RPC_URL ? [env.ARC_TESTNET_RPC_URL] : []),
  ...defaultRpcUrls,
].filter((url, index, list) => list.indexOf(url) === index);

for (const url of rpcUrls) {
  try {
    new URL(url);
  } catch {
    throw new Error('ARC_TESTNET_RPC_URL must be a valid URL.');
  }
}

const arcTestnet = defineChain({
  id: 5_042_002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: rpcUrls },
  },
});
const transport = fallback(rpcUrls.map((url) => http(url)));
const publicClient = createPublicClient({ chain: arcTestnet, transport });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport });

const connectedChainId = await publicClient.getChainId();
if (connectedChainId !== arcTestnet.id) {
  throw new Error(`RPC chain ID ${connectedChainId} does not match Arc Testnet ${arcTestnet.id}.`);
}

const vaultOwner = await publicClient.readContract({
  address: stakingVaultAddress,
  abi: vaultReadAbi,
  functionName: 'owner',
});
if (vaultOwner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(
    `Deploying account ${account.address} is not the owner of the configured StakingVault.`,
  );
}

if (rewardConfiguration) {
  const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
  if (rewardConfiguration.startTime <= latestBlock.timestamp) {
    throw new Error(
      `REWARD_PROGRAM_START must be in the future (latest block: ${latestBlock.timestamp}).`,
    );
  }

  const [usdcSupported, eurcSupported, usdcBalance, eurcBalance] = await Promise.all([
    publicClient.readContract({
      address: stakingVaultAddress,
      abi: vaultReadAbi,
      functionName: 'supportedAssets',
      args: [rewardConfiguration.usdcAddress],
    }),
    publicClient.readContract({
      address: stakingVaultAddress,
      abi: vaultReadAbi,
      functionName: 'supportedAssets',
      args: [rewardConfiguration.eurcAddress],
    }),
    publicClient.readContract({
      address: rewardConfiguration.usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
    publicClient.readContract({
      address: rewardConfiguration.eurcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ]);

  if (!usdcSupported || !eurcSupported) {
    throw new Error('Both configured assets must already be supported by StakingVault.');
  }
  if (usdcBalance < rewardConfiguration.usdcFunding) {
    throw new Error('Deploying account has insufficient USDC for the configured reward reserve.');
  }
  if (eurcBalance < rewardConfiguration.eurcFunding) {
    throw new Error('Deploying account has insufficient EURC for the configured reward reserve.');
  }
}

const deploymentHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: `0x${artifact.evm.bytecode.object}`,
  args: [account.address, stakingVaultAddress],
});
const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
if (deploymentReceipt.status !== 'success' || !deploymentReceipt.contractAddress) {
  throw new Error(`RewardDistributor deployment failed: ${deploymentHash}`);
}

const distributorAddress = deploymentReceipt.contractAddress;
const [deployedOwner, deployedVault] = await Promise.all([
  publicClient.readContract({
    address: distributorAddress,
    abi: artifact.abi,
    functionName: 'owner',
  }),
  publicClient.readContract({
    address: distributorAddress,
    abi: artifact.abi,
    functionName: 'stakingVault',
  }),
]);

if (deployedOwner.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error('Deployed RewardDistributor owner does not match the deploying account.');
}
if (deployedVault.toLowerCase() !== stakingVaultAddress.toLowerCase()) {
  throw new Error('Deployed RewardDistributor references the wrong StakingVault.');
}

console.log(`RewardDistributor deployed and verified: ${distributorAddress}`);
console.log(`Deployment transaction: ${deploymentHash}`);

if (!args.has('--configure')) {
  console.log('Deploy-only mode complete. No reward program was created or funded.');
  process.exit(0);
}

const {
  usdcAddress,
  eurcAddress,
  startTime,
  endTime,
  flexibleAnnualBps,
  growthAnnualBps,
  diamondAnnualBps,
  usdcFunding,
  eurcFunding,
} = rewardConfiguration;

async function writeAndConfirm(label, parameters) {
  const { request } = await publicClient.simulateContract({
    account,
    ...parameters,
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`${label} failed: ${hash}`);
  }
  console.log(`${label} confirmed: ${hash}`);
  return receipt;
}

async function createAndFundProgram(assetLabel, assetAddress, fundingAmount) {
  const expectedProgramId = await publicClient.readContract({
    address: distributorAddress,
    abi: artifact.abi,
    functionName: 'nextProgramId',
  });

  await writeAndConfirm(`Create ${assetLabel} reward program`, {
    address: distributorAddress,
    abi: artifact.abi,
    functionName: 'createProgram',
    args: [
      assetAddress,
      startTime,
      endTime,
      flexibleAnnualBps,
      growthAnnualBps,
      diamondAnnualBps,
    ],
  });

  const currentAllowance = await publicClient.readContract({
    address: assetAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, distributorAddress],
  });
  if (currentAllowance < fundingAmount) {
    if (currentAllowance > 0n) {
      await writeAndConfirm(`Reset ${assetLabel} reward allowance`, {
        address: assetAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [distributorAddress, 0n],
      });
    }
    await writeAndConfirm(`Approve ${assetLabel} reward funding`, {
      address: assetAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [distributorAddress, fundingAmount],
    });
  }

  await writeAndConfirm(`Fund ${assetLabel} reward program`, {
    address: distributorAddress,
    abi: artifact.abi,
    functionName: 'fundProgram',
    args: [expectedProgramId, fundingAmount],
  });

  const [
    latestProgramId,
    program,
    availableReserve,
    reservedByAsset,
    distributorTokenBalance,
  ] = await Promise.all([
    publicClient.readContract({
      address: distributorAddress,
      abi: artifact.abi,
      functionName: 'latestProgramId',
      args: [assetAddress],
    }),
    publicClient.readContract({
      address: distributorAddress,
      abi: artifact.abi,
      functionName: 'programs',
      args: [expectedProgramId],
    }),
    publicClient.readContract({
      address: distributorAddress,
      abi: artifact.abi,
      functionName: 'programAvailableReserve',
      args: [expectedProgramId],
    }),
    publicClient.readContract({
      address: distributorAddress,
      abi: artifact.abi,
      functionName: 'reservedByAsset',
      args: [assetAddress],
    }),
    publicClient.readContract({
      address: assetAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [distributorAddress],
    }),
  ]);

  const [
    configuredAsset,
    configuredStart,
    configuredEnd,
    configuredFlexibleBps,
    configuredGrowthBps,
    configuredDiamondBps,
    configuredFunding,
    configuredClaimed,
  ] = program;

  if (latestProgramId !== expectedProgramId) {
    throw new Error(`${assetLabel} latest program ID verification failed.`);
  }
  if (configuredAsset.toLowerCase() !== assetAddress.toLowerCase()) {
    throw new Error(`${assetLabel} program asset verification failed.`);
  }
  if (
    configuredStart !== startTime
    || configuredEnd !== endTime
    || configuredFlexibleBps !== flexibleAnnualBps
    || configuredGrowthBps !== growthAnnualBps
    || configuredDiamondBps !== diamondAnnualBps
  ) {
    throw new Error(`${assetLabel} program schedule/rate verification failed.`);
  }
  if (
    configuredFunding !== fundingAmount
    || configuredClaimed !== 0n
    || availableReserve !== fundingAmount
    || reservedByAsset !== fundingAmount
    || distributorTokenBalance < fundingAmount
  ) {
    throw new Error(`${assetLabel} reward reserve verification failed.`);
  }

  return expectedProgramId;
}

const usdcProgramId = await createAndFundProgram('USDC', usdcAddress, usdcFunding);
const eurcProgramId = await createAndFundProgram('EURC', eurcAddress, eurcFunding);

console.log(
  JSON.stringify(
    {
      rewardDistributor: distributorAddress,
      stakingVault: stakingVaultAddress,
      owner: account.address,
      program: {
        startTime: startTime.toString(),
        endTime: endTime.toString(),
        annualBps: {
          Flexible: flexibleAnnualBps,
          Growth: growthAnnualBps,
          Diamond: diamondAnnualBps,
        },
      },
      reserves: {
        USDC: {
          programId: usdcProgramId.toString(),
          fundedUnits: usdcFunding.toString(),
        },
        EURC: {
          programId: eurcProgramId.toString(),
          fundedUnits: eurcFunding.toString(),
        },
      },
      verification: 'deployment, ownership, schedules, rates, and reserves confirmed on-chain',
    },
    null,
    2,
  ),
);
