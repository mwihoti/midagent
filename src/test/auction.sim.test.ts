/**
 * In-process tests for the sealed-bid Auction contract (Level 4 MVP: commit
 * phase).
 *
 * Privacy properties under test: the bid amount and its blinding nonce are
 * private witnesses; public state may only ever hold the blinded commitment
 * persistentCommit(amount, nonce). Two bidders bidding the SAME amount must
 * also produce different commitments (the blinding property) — otherwise equal
 * bids would be visible as equal commitments.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../../contracts/auction/index.js';
import { bytes32, secret, initContext } from './helpers/simulator.js';

const PHASE_BIDDING = 1n;
const PHASE_CLOSED = 2n;

class AuctionSimulator {
  private contract: Contract<Record<string, never>>;
  private context: CircuitContext<Record<string, never>>;
  amount: Uint8Array;
  nonce: Uint8Array;

  constructor(amount = secret(0x42), nonce = secret(0x99)) {
    this.amount = amount;
    this.nonce = nonce;
    this.contract = new Contract({
      bidAmount: (ctx: any) => [ctx.privateState, this.amount],
      bidNonce: (ctx: any) => [ctx.privateState, this.nonce],
    });
    this.context = initContext(this.contract, {});
  }

  createAuction(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.createAuction(this.context, id).context;
  }

  commitBid(auctionId: Uint8Array, bidderId: Uint8Array): void {
    this.context = this.contract.impureCircuits.commitBid(
      this.context,
      auctionId,
      bidderId,
    ).context;
  }

  closeBidding(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.closeBidding(this.context, id).context;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}

describe('Auction (sealed-bid commit phase)', () => {
  let sim: AuctionSimulator;

  beforeEach(() => {
    sim = new AuctionSimulator();
  });

  it('starts with no auctions', () => {
    expect(sim.ledger().auctionCount).toBe(0n);
  });

  it('creates an auction in the bidding phase', () => {
    const id = bytes32('auction-1');
    sim.createAuction(id);

    const state = sim.ledger();
    expect(state.auctionCount).toBe(1n);
    expect(state.auctionPhase.lookup(id)).toBe(PHASE_BIDDING);
    expect(state.bidCounts.lookup(id)).toBe(0n);
  });

  it('rejects creating the same auction twice', () => {
    const id = bytes32('auction-dup');
    sim.createAuction(id);
    expect(() => sim.createAuction(id)).toThrow();
  });

  it('accepts a sealed bid and counts it', () => {
    const id = bytes32('auction-2');
    sim.createAuction(id);
    sim.commitBid(id, bytes32('bidder-a'));

    expect(sim.ledger().bidCounts.lookup(id)).toBe(1n);
  });

  it('rejects a second bid from the same bidder on the same auction', () => {
    const id = bytes32('auction-3');
    sim.createAuction(id);
    sim.commitBid(id, bytes32('bidder-a'));
    expect(() => sim.commitBid(id, bytes32('bidder-a'))).toThrow();
  });

  it('rejects bids after bidding is closed', () => {
    const id = bytes32('auction-4');
    sim.createAuction(id);
    sim.closeBidding(id);

    expect(sim.ledger().auctionPhase.lookup(id)).toBe(PHASE_CLOSED);
    expect(() => sim.commitBid(id, bytes32('late-bidder'))).toThrow();
  });

  it('rejects closing an auction twice', () => {
    const id = bytes32('auction-5');
    sim.createAuction(id);
    sim.closeBidding(id);
    expect(() => sim.closeBidding(id)).toThrow();
  });

  it('NEVER exposes the bid amount or nonce in public state', () => {
    const id = bytes32('auction-6');
    sim.createAuction(id);
    sim.commitBid(id, bytes32('bidder-a'));

    // The bids map holds exactly one entry: the commitment. It must equal
    // neither the raw amount nor the raw nonce.
    const entries = Array.from(sim.ledger().bids);
    expect(entries.length).toBe(1);
    const stored = entries[0][1];
    expect(Buffer.from(stored).equals(Buffer.from(sim.amount))).toBe(false);
    expect(Buffer.from(stored).equals(Buffer.from(sim.nonce))).toBe(false);
  });

  it('blinds equal bids: same amount, different nonce, different commitment', () => {
    // Two independent bidders bid the SAME amount with different nonces. If the
    // commitment were unblinded (a bare hash of the amount), the two ledger
    // entries would be equal and an observer could see the bids match.
    const id = bytes32('auction-7');
    const amount = secret(0x42);

    const a = new AuctionSimulator(amount, secret(0x01));
    a.createAuction(id);
    a.commitBid(id, bytes32('bidder-a'));
    const commitmentA = Array.from(a.ledger().bids)[0][1];

    const b = new AuctionSimulator(amount, secret(0x02));
    b.createAuction(id);
    b.commitBid(id, bytes32('bidder-b'));
    const commitmentB = Array.from(b.ledger().bids)[0][1];

    expect(Buffer.from(commitmentA).equals(Buffer.from(commitmentB))).toBe(false);
  });
});
