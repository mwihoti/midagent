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
} from '../managed/composition/contract/index.js';
import { Contract } from '../managed/composition/contract/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, '..', 'managed', 'composition');

export const CompiledCompositionContract = CompiledContract.make(
  'CompositionContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses({
    workflowDefinition: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
    stepOutput: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      return [_context.privateState, data];
    },
  }),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
