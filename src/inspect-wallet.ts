import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import pino from 'pino';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { MidnightWalletProvider, syncWalletUnshielded } from './wallet.js';
import { getConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// @ts-expect-error WebSocket global for the indexer subscription
globalThis.WebSocket = WebSocket;

const logger = pino({ level: 'warn', transport: { target: 'pino-pretty' } });

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

  const mnemonic = process.env['MIDNIGHT_PREPROD_MNEMONIC'];
  // build() already starts the wallet; don't call start() again.
  const w = mnemonic
    ? await MidnightWalletProvider.build(logger, envConfig as any, undefined, mnemonic)
    : await MidnightWalletProvider.build(logger, envConfig as any, '0000000000000000000000000000000000000000000000000000000000000001');

  const address = await w.wallet.unshielded.getAddress();
  const bech32 = MidnightBech32m.encode(config.networkId, address).toString();

  // Wait for the unshielded sync to complete so balances reflect on-chain state.
  const state: any = await syncWalletUnshielded(logger, w.wallet, 120_000).catch(() => null);

  console.log('\n========================================');
  console.log(`WALLET (${config.networkId})`);
  console.log('========================================');
  console.log('NIGHT address (fund this):');
  console.log('  ' + bech32);
  console.log('  (hex: ' + Buffer.from(address.data).toString('hex') + ')');

  if (state?.unshielded) {
    const coins = state.unshielded.totalCoins ?? state.unshielded.availableCoins ?? [];
    const val = (c: any) =>
      BigInt(c?.utxo?.value ?? c?.output?.value ?? c?.value ?? c?.utxo?.output?.value ?? 0);
    const total = coins.reduce((acc: bigint, c: any) => acc + val(c), 0n);
    // NIGHT has 6 decimals (1 NIGHT = 1_000_000 base units).
    const night = Number(total) / 1_000_000;
    console.log(`NIGHT UTXOs: ${coins.length}`);
    console.log(`NIGHT balance: ${night} NIGHT (${total} base units)`);
    if (coins[0]) {
      const c = coins[0];
      console.log('  first UTXO raw:', JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 300));
    }
  }
  console.log(`Faucet: ${config.faucet}`);
  console.log('========================================\n');

  await w.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
