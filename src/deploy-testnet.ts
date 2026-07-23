import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import pino from 'pino';
import * as dotenv from 'dotenv';

import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getConfig } from './config.js';
import { saveDeployments } from './deployments.js';
import { MidnightWalletProvider, syncWalletUnshielded } from './wallet.js';
import { buildProviders } from './providers.js';
import {
  CompiledAgentRegistryContract,
  zkConfigPath as agentZkPath,
} from '../contracts/agent-registry/index.js';
import {
  CompiledMarketplaceContract,
  zkConfigPath as mktZkPath,
} from '../contracts/marketplace/index.js';
import {
  CompiledPaymentsContract,
  zkConfigPath as payZkPath,
} from '../contracts/payments/index.js';
import {
  CompiledCompositionContract,
  zkConfigPath as compZkPath,
} from '../contracts/composition/index.js';

// NOTE: Do NOT override globalThis.WebSocket with the `ws` package here. Node 22+
// provides a native WebSocket that the Polkadot node client (tx submission) needs;
// replacing it with `ws` makes the relay connection close immediately (1000 Normal
// Closure) at submission time. The indexer client works fine with the native global.

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });

const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

async function main() {
  const config = getConfig();
  setNetworkId(config.networkId);

  const envConfig = {
    walletNetworkId: config.networkId as any,
    networkId: config.networkId,
    indexer: config.indexer,
    indexerWS: config.indexerWS,
    node: config.node,
    nodeWS: config.nodeWS,
    faucet: config.faucet,
    proofServer: config.proofServer,
  };

  console.log(`\nNetwork: ${config.networkId}`);
  console.log(`Node:    ${config.node}`);
  console.log(`Indexer: ${config.indexer}`);

  const mnemonic = process.env['MIDNIGHT_PREPROD_MNEMONIC'];
  if (mnemonic) {
    logger.info('Mnemonic found in environment');
  } else {
    logger.warn('Mnemonic NOT found in environment, falling back to default seed');
  }
  const wallet = mnemonic
    ? await MidnightWalletProvider.build(logger, envConfig, undefined, mnemonic)
    : await MidnightWalletProvider.build(logger, envConfig, SEED);
  const syncedState = await syncWalletUnshielded(logger, wallet.wallet, 60_000);
  logger.info('Wallet synced (unshielded).');

  // Halt the shielded (zswap) sync right away — it's the memory hog that OOMs a
  // cold sync, and a dust-fee-only deploy doesn't need it. Dust keeps syncing.
  await wallet.stopShielded();

  // NIGHT only generates the DUST used for fees once its UTXOs are registered.
  // Register (if needed) and wait for enough dust to accrue before deploying.
  const { registered, txId } = await wallet.registerForDustGeneration(syncedState);
  if (registered > 0) {
    logger.info(`Registered ${registered} NIGHT UTXO(s) for dust (tx ${txId}). Waiting for dust to accrue...`);
  }
  const dust = await wallet.waitForDust(1_000_000n);
  logger.info(`Spendable dust available: ${dust} Specks. Proceeding to deploy.`);

  const contracts = [
    { name: 'AgentRegistry', compiled: CompiledAgentRegistryContract, zkPath: agentZkPath },
    { name: 'Marketplace', compiled: CompiledMarketplaceContract, zkPath: mktZkPath },
    { name: 'Payments', compiled: CompiledPaymentsContract, zkPath: payZkPath },
    { name: 'Composition', compiled: CompiledCompositionContract, zkPath: compZkPath },
  ];

  const deployedAddresses: Record<string, string> = {};

  for (const { name, compiled, zkPath } of contracts) {
    const providers = buildProviders(wallet, zkPath, config);

    try {
      const deployed: any = await (deployContract as any)(providers, {
        compiledContract: compiled,
        privateStateId: `${name}-${Date.now()}`,
        initialPrivateState: {},
        args: [],
      });

      const addr = deployed.deployTxData.public.contractAddress;
      deployedAddresses[name] = addr;
      console.log(`\n========================================`);
      console.log(`${name} Contract Deployed`);
      console.log(`  Address: ${addr}`);
      console.log(`========================================\n`);
    } catch (err) {
      console.error(`${name} deploy failed:`, (err as Error).message?.substring(0, 300));
    }
  }

  if (Object.keys(deployedAddresses).length > 0) {
    const file = saveDeployments(config.networkId, deployedAddresses);
    console.log(`\nSaved real addresses to ${file}`);
  } else {
    console.log('\nNo contracts deployed; address file not updated.');
  }

  await wallet.stop();
  console.log('\nAll deployments complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
