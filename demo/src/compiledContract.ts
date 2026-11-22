import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  getNumericSecret,
  getSecret,
  hasSecret,
  scopedName,
  setRandomSecret,
  setSecret,
} from './privateState';

/**
 * Bind a witness to the locally-stored secret of the same name. The value is
 * read from local private state at call time, so `proveOwnership` re-derives the
 * same commitment `registerAgent` published. Nothing here is ever sent on-chain —
 * only commitments derived from it inside the circuit are.
 */
const w =
  (name: string, size: number) =>
  (ctx: any): [any, Uint8Array] => [ctx.privateState, getSecret(name, size)];

/**
 * Like `w`, but (a) refuses to fall back to an all-zero secret and (b) reads
 * the secret scoped to the contract being called (`name:<address>`). Used for
 * the ScamShield identity secrets: a zero issuer secret would let anyone act
 * as the issuer, and one secret shared across registries would make a member's
 * commitments (and an issuer's keys) publicly linkable between registries.
 * `fallback` is consulted only when no scoped secret exists yet.
 */
const requiredScoped =
  (name: string, size: number, fallback?: string) =>
  (ctx: any): [any, Uint8Array] => {
    const scoped = scopedName(name, String(ctx.contractAddress));
    const key = hasSecret(scoped) ? scoped : fallback;
    if (!key || !hasSecret(key)) {
      throw new Error(`No ${name} stored in this browser for this registry`);
    }
    return [ctx.privateState, getSecret(key, size)];
  };

/** Fresh issuer secret for a deploy in flight (the address is not known yet). */
const PENDING_ISSUER_SECRET = 'issuerSecret:pending';

export type ContractKey =
  | 'agent-registry'
  | 'marketplace'
  | 'payments'
  | 'composition'
  | 'auction'
  | 'fraud-registry';

interface ContractDef {
  label: string;
  className: string;
  load: () => Promise<any>;
  // Most witnesses take only the context; some (e.g. a Merkle-path witness)
  // take extra circuit-supplied arguments and return structured values,
  // and some (the auction's bidAmount) return a bigint rather than bytes.
  witnesses: Record<string, (ctx: any, ...args: any[]) => [any, any]>;
  /** Runs right before deploy, e.g. to make sure constructor secrets exist. */
  beforeDeploy?: () => void;
  /**
   * Runs as soon as a deploy's address is known, before anything is submitted,
   * so a secret cannot be lost if confirmation never reaches this browser.
   */
  saveDeploySecrets?: (contractAddress: string) => void;
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
  auction: {
    label: 'Sealed-Bid Auction',
    className: 'AuctionContract',
    load: () => import('../../contracts/managed/auction/contract/index.js'),
    witnesses: {
      bidAmount: (ctx: any): [any, bigint] => [ctx.privateState, getNumericSecret('bidAmount')],
      bidNonce: w('bidNonce', 32),
      ownerSecret: w('ownerSecret', 32),
      bidderSecret: w('bidderSecret', 32),
    },
  },
  'fraud-registry': {
    label: 'ScamShield Registry',
    className: 'FraudRegistryContract',
    load: () => import('../../contracts/managed/fraud-registry/contract/index.js'),
    witnesses: {
      // Per-registry secrets. While deploying, the constructor runs before the
      // address is known, so it falls back to the fresh pending issuer secret
      // created by beforeDeploy (saved under the real address by saveDeploySecrets).
      issuerSecret: requiredScoped('issuerSecret', 32, PENDING_ISSUER_SECRET),
      reporterSecret: requiredScoped('reporterSecret', 32),
      // The circuit asks for the Merkle path to the reporter's own commitment.
      // ctx.ledger is the contract's public ledger as this client currently
      // sees it, so the path is built locally against the latest tree — which
      // member we are never leaves the browser (only the path's root is public).
      reporterPath: (ctx: any, leaf: Uint8Array): [any, any] => {
        const path = ctx.ledger.reporters.findPathForLeaf(leaf);
        if (!path) {
          throw new Error('This reporter secret is not enrolled in this registry');
        }
        return [ctx.privateState, path];
      },
    },
    // The constructor derives the public issuerKey from issuerSecret, so it must
    // be random (and kept) before deploying — never the all-zero default. A
    // FRESH secret per deploy, so registries deployed from one browser do not
    // share a public issuerKey.
    beforeDeploy: () => {
      setRandomSecret(PENDING_ISSUER_SECRET, 32);
      if (!hasSecret(PENDING_ISSUER_SECRET)) {
        throw new Error(
          'This browser cannot store secrets (storage is blocked or full), so it cannot hold the issuer secret for a new registry.',
        );
      }
    },
    saveDeploySecrets: (contractAddress: string) => {
      const name = scopedName('issuerSecret', contractAddress);
      setSecret(name, getSecret(PENDING_ISSUER_SECRET, 32));
      if (!hasSecret(name)) {
        throw new Error('Could not save the issuer secret, so the registry was not deployed.');
      }
    },
  },
};

const cache: Partial<Record<ContractKey, any>> = {};

export async function getCompiledContract(key: ContractKey = 'agent-registry') {
  if (cache[key]) return cache[key];

  const def = CONTRACTS[key];
  const { Contract } = await def.load();

  cache[key] = CompiledContract.make(def.className, Contract).pipe(
    // Cast: our witness stubs are generic across the contracts, but
    // withWitnesses is typed to one specific contract's witness set.
    CompiledContract.withWitnesses(def.witnesses as any),
    CompiledContract.withCompiledFileAssets(`/contract/${key}`),
  );

  return cache[key];
}
