/**
 * In-process tests for the Payments contract.
 *
 * Privacy property under test: escrow and subscription "details" (where an
 * amount, payer and payee would be packed) are private witnesses and must only
 * ever reach public state as commitments.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../../contracts/payments/index.js';
import { bytes32, secret, initContext } from './helpers/simulator.js';

const ESCROW_DETAILS = secret(0xd1);
const SUBSCRIPTION_DETAILS = secret(0xd2);

class PaymentsSimulator {
  private contract: Contract<Record<string, never>>;
  private context: CircuitContext<Record<string, never>>;

  constructor() {
    this.contract = new Contract({
      escrowDetails: (ctx: any) => [ctx.privateState, ESCROW_DETAILS],
      subscriptionDetails: (ctx: any) => [ctx.privateState, SUBSCRIPTION_DETAILS],
    });
    this.context = initContext(this.contract, {});
  }

  createEscrow(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.createEscrow(this.context, id).context;
  }

  releaseEscrow(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.releaseEscrow(this.context, id).context;
  }

  createSubscription(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.createSubscription(this.context, id).context;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}

describe('Payments', () => {
  let sim: PaymentsSimulator;

  beforeEach(() => {
    sim = new PaymentsSimulator();
  });

  it('starts with no escrows or subscriptions', () => {
    expect(sim.ledger().escrows.isEmpty()).toBe(true);
    expect(sim.ledger().subscriptions.isEmpty()).toBe(true);
  });

  it('creates an escrow', () => {
    const id = bytes32('escrow-1');
    sim.createEscrow(id);
    expect(sim.ledger().escrows.member(id)).toBe(true);
  });

  it('rejects releasing an escrow that does not exist', () => {
    expect(() => sim.releaseEscrow(bytes32('missing'))).toThrow();
  });

  it('creates a subscription', () => {
    const id = bytes32('sub-1');
    sim.createSubscription(id);
    expect(sim.ledger().subscriptions.member(id)).toBe(true);
  });

  it('NEVER exposes escrow details in public state', () => {
    const id = bytes32('escrow-2');
    sim.createEscrow(id);

    const stored = sim.ledger().escrows.lookup(id);
    expect(Buffer.from(stored).equals(Buffer.from(ESCROW_DETAILS))).toBe(false);
  });

  it('NEVER exposes subscription details in public state', () => {
    const id = bytes32('sub-2');
    sim.createSubscription(id);

    const stored = sim.ledger().subscriptions.lookup(id);
    expect(Buffer.from(stored).equals(Buffer.from(SUBSCRIPTION_DETAILS))).toBe(false);
  });
});
