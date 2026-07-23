import { CompiledContract } from '@midnight-ntwrk/compact-js';

// A zeroed witness value of the right byte length. Deploys never invoke witnesses
// (they only run during circuit calls), but the compiled contract must still be
// constructed with witness stubs of the correct shape.
const zero = (n: number) => new Uint8Array(n);
const w = (n: number) => (ctx: any): [any, Uint8Array] => [ctx.privateState, zero(n)];

export type ContractKey =
  | 'agent-registry'
  | 'marketplace'
  | 'payments'
  | 'composition';

interface ContractDef {
  label: string;
  className: string;
  load: () => Promise<any>;
  witnesses: Record<string, (ctx: any) => [any, Uint8Array]>;
}

export const CONTRACTS: Record<ContractKey, ContractDef> = {
  'agent-registry': {
    label: 'Agent Registry',
    className: 'AgentRegistryContract',
    load: () => import('../../contracts/managed/agent-registry/contract/index.js'),
    witnesses: { agentCapabilities: w(32) },
  },
  marketplace: {
    label: 'Marketplace',
    className: 'MarketplaceContract',
    load: () => import('../../contracts/managed/marketplace/contract/index.js'),
    witnesses: {
      intentRequirements: w(32),
      agentCapabilityProof: w(64),
      callerAddress: w(32),
    },
  },
  payments: {
    label: 'Payments',
    className: 'PaymentsContract',
    load: () => import('../../contracts/managed/payments/contract/index.js'),
    witnesses: { escrowDetails: w(32), subscriptionDetails: w(32) },
  },
  composition: {
    label: 'Composition',
    className: 'CompositionContract',
    load: () => import('../../contracts/managed/composition/contract/index.js'),
    witnesses: { workflowDefinition: w(32), stepOutput: w(32) },
  },
};

const cache: Partial<Record<ContractKey, any>> = {};

export async function getCompiledContract(key: ContractKey = 'agent-registry') {
  if (cache[key]) return cache[key];

  const def = CONTRACTS[key];
  const { Contract } = await def.load();

  cache[key] = CompiledContract.make(def.className, Contract).pipe(
    // Cast: our witness stubs are generic across the four contracts, but
    // withWitnesses is typed to one specific contract's witness set.
    CompiledContract.withWitnesses(def.witnesses as any),
    CompiledContract.withCompiledFileAssets(`/contract/${key}`),
  );

  return cache[key];
}
