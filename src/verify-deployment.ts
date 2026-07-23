import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { getConfig } from './config.js';
import { deploymentFilePath, loadDeployments } from './deployments.js';

// @ts-expect-error WebSocket global for apollo
globalThis.WebSocket = WebSocket;

async function main() {
  const config = getConfig();
  setNetworkId(config.networkId);

  console.log(`Checking deployments on ${config.networkId}...`);
  console.log(`Indexer: ${config.indexer}\n`);

  const deployments = loadDeployments(config.networkId);
  if (!deployments || Object.keys(deployments.contracts).length === 0) {
    console.error(
      `No deployment addresses found for network "${config.networkId}".\n` +
        `Expected file: ${deploymentFilePath(config.networkId)}\n\n` +
        `Deploy first so real on-chain addresses are saved:\n` +
        `  MIDNIGHT_NETWORK=${config.networkId === 'undeployed' ? 'local' : config.networkId} npx tsx src/deploy-testnet.ts`,
    );
    process.exit(1);
  }

  console.log(`Using addresses from ${deploymentFilePath(config.networkId)}`);
  console.log(`Deployed at: ${deployments.deployedAt}\n`);

  const provider = indexerPublicDataProvider(config.indexer, config.indexerWS);

  try {
    const status = await provider.queryNetworkStatus();
    console.log(`Indexer status:`);
    console.log(`  Network ID: ${status.networkId}`);
    console.log(`  Latest Block: ${status.blockHeight}`);
    console.log(`  Sync Status: ${status.isSynced ? 'Synced' : 'Syncing...'}\n`);
  } catch (err) {
    console.log(`⚠️  Failed to fetch indexer status: ${(err as Error).message}\n`);
  }

  let found = 0;
  let missing = 0;

  for (const [name, address] of Object.entries(deployments.contracts)) {
    try {
      const state = await provider.queryContractState(address);
      if (state) {
        found += 1;
        console.log(`✅ ${name}: Found at ${address}`);
        console.log(`   Last block height: ${state.blockHeight}`);
      } else {
        missing += 1;
        console.log(`❌ ${name}: Not found at ${address}`);
      }
    } catch (err) {
      missing += 1;
      console.log(`⚠️  ${name}: Error checking ${address} - ${(err as Error).message}`);
    }
  }

  console.log(`\nSummary: ${found} found, ${missing} missing`);
  if (missing > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
