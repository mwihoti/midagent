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
    bidAmount: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
    bidNonce: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
  }),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
