/**
 * Fast, in-process tests for the Agent Registry contract.
 *
 * These run the compiled Compact circuits directly through the compact-runtime
 * simulator — no devnet, no proof server, no wallet — so they're deterministic
 * and finish in milliseconds, which is what makes them suitable for CI.
 *
 * The registry is our "Confidential Credentials" primitive: an agent registers
 * a capability *commitment* on-chain and can later prove ownership, but the raw
 * capabilities are supplied as a private witness and never enter public state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../../contracts/agent-registry/index.js';

const COIN_PUBLIC_KEY = '0'.repeat(64);

// The private capability data. In a real deployment this is the agent's actual
// capabilities; here it's a fixed secret we can assert never leaks on-chain.
const CAPABILITIES = new Uint8Array(32).fill(0xab);

function agentId(label: string): Uint8Array {
  const id = new Uint8Array(32);
  id.set(new TextEncoder().encode(label).slice(0, 32));
  return id;
}

/**
 * Minimal simulator: constructs the contract in memory and threads the circuit
 * context through each call, exactly as the chain would, but locally.
 */
class RegistrySimulator {
  private contract: Contract<Record<string, never>>;
  private context: CircuitContext<Record<string, never>>;

  constructor() {
    this.contract = new Contract({
      // The witness feeds private capabilities into the circuit. It is proven
      // against the on-chain commitment but is never itself published.
      agentCapabilities: (ctx: any) => [ctx.privateState, CAPABILITIES],
    });

    const { currentContractState, currentPrivateState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY));

    this.context = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );
  }

  registerAgent(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.registerAgent(this.context, id).context;
  }

  proveOwnership(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.proveOwnership(this.context, id).context;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}

describe('Agent Registry (Confidential Credentials)', () => {
  let sim: RegistrySimulator;

  beforeEach(() => {
    sim = new RegistrySimulator();
  });

  it('starts empty with an agent count of zero', () => {
    expect(sim.ledger().agentCount).toBe(0n);
  });

  it('registers an agent and records its commitment publicly', () => {
    const id = agentId('data-analyzer');
    sim.registerAgent(id);

    const state = sim.ledger();
    expect(state.agentCount).toBe(1n);
    expect(state.agents.member(id)).toBe(true);
  });

  it('tracks multiple distinct agents', () => {
    sim.registerAgent(agentId('agent-a'));
    sim.registerAgent(agentId('agent-b'));

    expect(sim.ledger().agentCount).toBe(2n);
  });

  it('lets the owner prove ownership without a revert', () => {
    const id = agentId('owned-agent');
    sim.registerAgent(id);
    expect(() => sim.proveOwnership(id)).not.toThrow();
  });

  it('NEVER exposes the raw capabilities in public state (the privacy property)', () => {
    const id = agentId('secret-agent');
    sim.registerAgent(id);

    // The public ledger only holds a commitment. The stored value must not be
    // the raw capabilities witness — that would defeat the whole design.
    const committed = sim.ledger().agents.lookup(id);
    expect(committed).not.toEqual(CAPABILITIES);
    // And there is no way to read the secret back out of public state.
    expect(Buffer.from(committed).equals(Buffer.from(CAPABILITIES))).toBe(false);
  });
});
