import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import pino from 'pino';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { MidnightWalletProvider } from './wallet.js';
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
  const w = mnemonic
    ? await MidnightWalletProvider.build(logger, envConfig as any, undefined, mnemonic)
    : await MidnightWalletProvider.build(logger, envConfig as any, '0000000000000000000000000000000000000000000000000000000000000001');

  const strict = (p: any) =>
    p && typeof p.isStrictlyComplete === 'function' ? p.isStrictlyComplete() : 'n/a';
  const idx = (p: any) =>
    p ? `applied=${p.appliedIndex ?? p.appliedId ?? '?'} highest=${p.highestIndex ?? '?'} relevant=${p.highestRelevantIndex ?? '?'} conn=${p.isConnected ?? '?'}` : 'null';

  // Observe emissions, printing sync progress, until dust sync is strictly
  // complete (or a time budget elapses).
  const s: any = await new Promise((resolve) => {
    let latest: any = null;
    let n = 0;
    const sub = w.wallet.state().subscribe((st: any) => {
      latest = st;
      n++;
      const dustDone = strict(st?.dust?.state?.progress);
      if (n <= 3 || n % 50 === 0) {
        console.log(`emission ${n}:`);
        console.log(`  unshielded ${idx(st?.unshielded?.progress)}`);
        console.log(`  shielded   ${idx(st?.shielded?.state?.progress)}`);
        console.log(`  dust       ${idx(st?.dust?.state?.progress)}`);
      }
      if (dustDone === true) {
        sub.unsubscribe();
        resolve(latest);
      }
    });
    setTimeout(() => {
      sub.unsubscribe();
      resolve(latest);
    }, 180_000);
  });

  const now = new Date();
  const night = (s?.unshielded?.totalCoins ?? []) as any[];
  const registered = night.filter((u) => u.meta?.registeredForDustGeneration);
  const dustAvail = (s?.dust?.availableCoins ?? []) as any[];
  const dustTotalCoins = (s?.dust?.totalCoins ?? []) as any[];
  const dustPending = (s?.dust?.pendingCoins ?? []) as any[];

  console.log('\n========================================');
  console.log(`DUST DIAGNOSTIC (${config.networkId})`);
  console.log('========================================');
  console.log(`dust sync strictly complete: ${strict(s?.dust?.state?.progress)}`);
  console.log(`NIGHT UTXOs:            ${night.length} (registered: ${registered.length})`);
  console.log(`DUST totalCoins:        ${dustTotalCoins.length}`);
  console.log(`DUST availableCoins:    ${dustAvail.length}`);
  console.log(`DUST pendingCoins:      ${dustPending.length}`);

  try {
    const full = s?.dust?.availableCoinsWithFullInfo?.(now) ?? [];
    const specks = full.reduce((acc: bigint, c: any) => acc + BigInt(c.generatedNow ?? 0), 0n);
    console.log(`Spendable dust now:     ${specks} Specks (${full.length} coins)`);
    for (const c of full.slice(0, 5)) {
      console.log('  generatedNow:', String(c.generatedNow ?? '?'),
        'maxCap:', String(c.maxCap ?? '?'),
        'maxCapReachedAt:', c.maxCapReachedAt ? new Date(c.maxCapReachedAt).toISOString() : '?');
    }
  } catch (e) {
    console.log('availableCoinsWithFullInfo failed:', (e as Error).message);
  }
  console.log('========================================\n');

  await w.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
