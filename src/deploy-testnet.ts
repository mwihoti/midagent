import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { WebSocket } from 'ws';
import pino from 'pino';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig } from './config.js';
import { MidnightWalletProvider, syncWallet } from './wallet.js';
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

// @ts-expect-error WebSocket global for apollo
globalThis.WebSocket = WebSocket;

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

  const wallet = await MidnightWalletProvider.build(logger, envConfig, SEED);
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 600_000);
  logger.info('Wallet synced.');

  const contracts = [
    { name: 'AgentRegistry', compiled: CompiledAgentRegistryContract, zkPath: agentZkPath },
    { name: 'Marketplace', compiled: CompiledMarketplaceContract, zkPath: mktZkPath },
    { name: 'Payments', compiled: CompiledPaymentsContract, zkPath: payZkPath },
    { name: 'Composition', compiled: CompiledCompositionContract, zkPath: compZkPath },
  ];

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
      console.log(`\n========================================`);
      console.log(`${name} Contract Deployed`);
      console.log(`  Address: ${addr}`);
      console.log(`========================================\n`);
    } catch (err) {
      console.error(`${name} deploy failed:`, (err as Error).message?.substring(0, 300));
    }
  }

  await wallet.stop();
  console.log('\nAll deployments complete.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
