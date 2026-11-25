import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { MerkleTreePath, WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
  type Witnesses,
} from '../managed/fraud-registry/contract/index.js';
import { Contract, type Ledger } from '../managed/fraud-registry/contract/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(currentDir, '..', 'managed', 'fraud-registry');

/**
 * Local (never on-chain) secrets for the fraud registry.
 *   issuerSecret   — only the deploying community org holds this; required at
 *                    deploy time (the constructor derives issuerKey from it)
 *                    and for every enrollReporter call.
 *   reporterSecret — a member's random secret; only reporterCommitment(secret)
 *                    is ever handed to the issuer.
 */
export type FraudRegistryPrivateState = {
  issuerSecret?: Uint8Array;
  reporterSecret?: Uint8Array;
};

/**
 * Build the reporterPath witness value: the Merkle path to `leaf` in the
 * CURRENT reporters tree, read from the public ledger the witness context
 * carries. The circuit then checks the path's root against the tree's root
 * history, so a path built here stays valid after later enrollments.
 */
export function reporterPathFromLedger(
  ledgerState: Ledger,
  leaf: Uint8Array,
): MerkleTreePath<Uint8Array> {
  const p = ledgerState.reporters.findPathForLeaf(leaf);
  if (!p) throw new Error('reporter commitment is not enrolled in this registry');
  return p;
}

function requireSecret(value: Uint8Array | undefined, name: string): Uint8Array {
  if (!value || value.length !== 32) {
    throw new Error(`fraud-registry: missing 32-byte ${name} in private state`);
  }
  return value;
}

export const fraudRegistryWitnesses = {
  issuerSecret: (
    context: WitnessContext<Ledger, FraudRegistryPrivateState>,
  ): [FraudRegistryPrivateState, Uint8Array] => [
    context.privateState,
    requireSecret(context.privateState?.issuerSecret, 'issuerSecret'),
  ],
  reporterSecret: (
    context: WitnessContext<Ledger, FraudRegistryPrivateState>,
  ): [FraudRegistryPrivateState, Uint8Array] => [
    context.privateState,
    requireSecret(context.privateState?.reporterSecret, 'reporterSecret'),
  ],
  reporterPath: (
    context: WitnessContext<Ledger, FraudRegistryPrivateState>,
    leaf: Uint8Array,
  ): [FraudRegistryPrivateState, MerkleTreePath<Uint8Array>] => [
    context.privateState,
    reporterPathFromLedger(context.ledger, leaf),
  ],
};

export const CompiledFraudRegistryContract = CompiledContract.make(
  'FraudRegistryContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses(fraudRegistryWitnesses as any),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
