import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { getSecret } from './privateState';

/**
 * Bind a witness to the locally-stored secret of the same name. The value is
 * read from local private state at call time, so `proveOwnership` re-derives the
 * same commitment `registerAgent` published. Nothing here is ever sent on-chain —
 * only commitments derived from it inside the circuit are.
 */
const w =
  (name: string, size: number) =>
  (ctx: any): [any, Uint8Array] => [ctx.privateState, getSecret(name, size)];

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
    witnesses: { agentCapabilities: w('agentCapabilities', 32) },
  },
  marketplace: {
    label: 'Marketplace',
    className: 'MarketplaceContract',
    load: () => import('../../contracts/managed/marketplace/contract/index.js'),
    witnesses: {
      intentRequirements: w('intentRequirements', 32),
      agentCapabilityProof: w('agentCapabilityProof', 64),
      callerAddress: w('callerAddress', 32),
    },
  },
  payments: {
    label: 'Payments',
    className: 'PaymentsContract',
    load: () => import('../../contracts/managed/payments/contract/index.js'),
    witnesses: {
      escrowDetails: w('escrowDetails', 32),
      subscriptionDetails: w('subscriptionDetails', 32),
    },
  },
  composition: {
    label: 'Composition',
    className: 'CompositionContract',
    load: () => import('../../contracts/managed/composition/contract/index.js'),
    witnesses: {
      workflowDefinition: w('workflowDefinition', 32),
      stepOutput: w('stepOutput', 32),
    },
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
