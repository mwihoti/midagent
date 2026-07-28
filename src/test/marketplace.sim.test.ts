/**
 * In-process tests for the Marketplace contract.
 *
 * Privacy properties under test: a buyer's intent requirements and the matcher's
 * address are both private witnesses, and must only ever reach public state as
 * commitments.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../../contracts/marketplace/index.js';
import { bytes32, secret, initContext } from './helpers/simulator.js';

// Private witness values. Distinct fills so a leak of either is unmistakable.
const REQUIREMENTS = secret(0xaa);
const CALLER = secret(0xbb);
const CAPABILITY_PROOF = secret(0xcc, 64);

class MarketplaceSimulator {
  private contract: Contract<Record<string, never>>;
  private context: CircuitContext<Record<string, never>>;

  constructor() {
    this.contract = new Contract({
      intentRequirements: (ctx: any) => [ctx.privateState, REQUIREMENTS],
      agentCapabilityProof: (ctx: any) => [ctx.privateState, CAPABILITY_PROOF],
      callerAddress: (ctx: any) => [ctx.privateState, CALLER],
    });
    this.context = initContext(this.contract, {});
  }

  submitIntent(intentId: Uint8Array): void {
    this.context = this.contract.impureCircuits.submitIntent(this.context, intentId).context;
  }

  matchIntent(intentId: Uint8Array, agentId: Uint8Array): void {
    this.context = this.contract.impureCircuits.matchIntent(
      this.context,
      intentId,
      agentId,
    ).context;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}

describe('Marketplace', () => {
  let sim: MarketplaceSimulator;

  beforeEach(() => {
    sim = new MarketplaceSimulator();
  });

  it('starts with no intents', () => {
    expect(sim.ledger().intentCount).toBe(0n);
  });

  it('records a submitted intent and bumps the public counter', () => {
    const id = bytes32('intent-1');
    sim.submitIntent(id);

    const state = sim.ledger();
    expect(state.intentCount).toBe(1n);
    expect(state.intents.member(id)).toBe(true);
  });

  it('rejects matching an intent that was never submitted', () => {
    expect(() => sim.matchIntent(bytes32('nope'), bytes32('agent-1'))).toThrow();
  });

  it('records a match against a submitted intent', () => {
    const id = bytes32('intent-2');
    sim.submitIntent(id);
    sim.matchIntent(id, bytes32('agent-1'));

    expect(sim.ledger().matches.member(id)).toBe(true);
  });

  it('NEVER exposes the buyer requirements in public state', () => {
    const id = bytes32('intent-3');
    sim.submitIntent(id);

    const stored = sim.ledger().intents.lookup(id);
    expect(Buffer.from(stored).equals(Buffer.from(REQUIREMENTS))).toBe(false);
  });

  it('NEVER exposes the matcher address in public state', () => {
    const id = bytes32('intent-4');
    const agentId = bytes32('agent-1');
    sim.submitIntent(id);
    sim.matchIntent(id, agentId);

    // matches stores Vector<2, Bytes<32>> = [agentId, callerCommitment].
    const [storedAgentId, storedCaller] = sim.ledger().matches.lookup(id);

    // The agent id is a public circuit input, so it is recorded verbatim.
    expect(Buffer.from(storedAgentId).equals(Buffer.from(agentId))).toBe(true);
    // The caller address is a private witness and must only appear committed.
    expect(Buffer.from(storedCaller).equals(Buffer.from(CALLER))).toBe(false);
  });
});
