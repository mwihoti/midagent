import { CompiledContract } from '@midnight-ntwrk/compact-js';

let cachedContract: any = null;

export async function getCompiledContract() {
  if (cachedContract) return cachedContract;

  const { Contract } = await import(
    '../../contracts/managed/agent-registry/contract/index.js'
  );

  cachedContract = CompiledContract.make('AgentRegistryContract', Contract).pipe(
    CompiledContract.withWitnesses({
      agentCapabilities: (_context: any): [any, Uint8Array] => {
        const data = new Uint8Array(32);
        data[0] = 0x01;
        return [_context.privateState, data];
      },
    }),
    CompiledContract.withCompiledFileAssets('/contract/agent-registry'),
  );

  return cachedContract;
}
