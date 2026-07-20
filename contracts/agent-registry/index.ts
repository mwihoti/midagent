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
} from '../managed/agent-registry/contract/index.js';
import { Contract } from '../managed/agent-registry/contract/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, '..', 'managed', 'agent-registry');

export const CompiledAgentRegistryContract = CompiledContract.make(
  'AgentRegistryContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses({
    agentCapabilities: (_context: any): [any, Uint8Array] => {
      const data = new Uint8Array(32);
      data[0] = 0x01; // capabilities marker
      return [_context.privateState, data];
    },
  }),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
