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
} from '../managed/payments/contract/index.js';
import { Contract } from '../managed/payments/contract/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, '..', 'managed', 'payments');

export const CompiledPaymentsContract = CompiledContract.make(
  'PaymentsContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses({
    escrowDetails: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
    subscriptionDetails: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
  }),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
