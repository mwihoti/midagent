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
} from '../managed/marketplace/contract/index.js';
import { Contract } from '../managed/marketplace/contract/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, '..', 'managed', 'marketplace');

export const CompiledMarketplaceContract = CompiledContract.make(
  'MarketplaceContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses({
    intentRequirements: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
    agentCapabilityProof: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(64);
      return [_context.privateState, data];
    },
    callerAddress: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
  }),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
