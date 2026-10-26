import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
} from '../managed/auction/contract/index.js';
import { Contract } from '../managed/auction/contract/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, '..', 'managed', 'auction');

export const CompiledAuctionContract = CompiledContract.make(
  'AuctionContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses({
    // Deploy does not call circuits. Real witnesses are supplied by the DApp
    // (browser private state) and by the simulator tests.
    bidAmount: (_context: any): [any, bigint] => [_context.privateState, 0n],
    bidNonce: (_context: any): [any, Uint8Array] => [_context.privateState, new Uint8Array(32)],
    ownerSecret: (_context: any): [any, Uint8Array] => [_context.privateState, new Uint8Array(32)],
    bidderSecret: (_context: any): [any, Uint8Array] => [_context.privateState, new Uint8Array(32)],
  }),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
