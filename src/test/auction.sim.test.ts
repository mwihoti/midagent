/**
 * In-process tests for the sealed-bid procurement auction.
 *
 * Privacy properties under test: the bid amount and its blinding nonce are
 * private witnesses; until a bid becomes the lowest revealed bid, public state
 * holds only persistentCommit(amount, nonce). Two bidders bidding the SAME
 * amount must produce different commitments. The owner secret and the bidder
 * secret are checked by hash, so a non-owner cannot close or finalize, and a
 * bidder cannot reveal someone else's commitment.
 *
 * Winner rule: lowest revealed amount wins (procurement). Ties keep the first
 * reveal. The winning amount is public; a bid that never takes the lead is not
 * written into any public numeric field.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../../contracts/auction/index.js';
import { bytes32, secret, initContext } from './helpers/simulator.js';

const PHASE_BIDDING = 1n;
const PHASE_REVEAL = 2n;
const PHASE_FINAL = 3n;

class AuctionSimulator {
  private contract: Contract<Record<string, never>>;
  private context: CircuitContext<Record<string, never>>;
  amount: bigint;
  nonce: Uint8Array;
  ownerSecret: Uint8Array;
  bidderSecret: Uint8Array;

  constructor(
    amount = 66n,
    nonce = secret(0x99),
    ownerSecret = secret(0x11),
    bidderSecret = secret(0x22),
  ) {
    this.amount = amount;
    this.nonce = nonce;
    this.ownerSecret = ownerSecret;
    this.bidderSecret = bidderSecret;
    this.contract = new Contract({
      bidAmount: (ctx: any) => [ctx.privateState, this.amount],
      bidNonce: (ctx: any) => [ctx.privateState, this.nonce],
      ownerSecret: (ctx: any) => [ctx.privateState, this.ownerSecret],
      bidderSecret: (ctx: any) => [ctx.privateState, this.bidderSecret],
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

  revealBid(auctionId: Uint8Array, bidderId: Uint8Array): void {
    this.context = this.contract.impureCircuits.revealBid(
      this.context,
      auctionId,
      bidderId,
    ).context;
  }

  finalizeAuction(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.finalizeAuction(this.context, id).context;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}

/** Every public numeric field. Used to prove a losing amount was not published. */
function publicNumbers(state: Ledger): bigint[] {
  return [
    state.auctionCount,
    ...Array.from(state.auctionPhase, ([, value]) => value),
    ...Array.from(state.bidCounts, ([, value]) => value),
    ...Array.from(state.revealedCounts, ([, value]) => value),
    ...Array.from(state.winningBid, ([, value]) => value),
  ];
}

function publicByteValues(state: Ledger): Uint8Array[] {
  return [
    ...Array.from(state.bids, ([, value]) => value),
    ...Array.from(state.bidAuth, ([, value]) => value),
    ...Array.from(state.auctionOwner, ([, value]) => value),
    ...Array.from(state.winningBidder, ([, value]) => value),
  ];
}

function containsBytes(values: Uint8Array[], needle: Uint8Array): boolean {
  return values.some((value) => Buffer.from(value).equals(Buffer.from(needle)));
}

describe('Auction (sealed-bid procurement)', () => {
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
    expect(state.revealedCounts.lookup(id)).toBe(0n);
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

    expect(sim.ledger().auctionPhase.lookup(id)).toBe(PHASE_REVEAL);
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

    const state = sim.ledger();
    const entries = Array.from(state.bids);
    expect(entries.length).toBe(1);
    const stored = entries[0][1];
    expect(Buffer.from(stored).equals(Buffer.from(sim.nonce))).toBe(false);
    // Commit publishes a commitment, not the amount. Nothing numeric on the
    // ledger is the bid (66), and the owner/bidder secrets are not stored raw.
    expect(state.winningBid.isEmpty()).toBe(true);
    expect(publicNumbers(state)).not.toContain(sim.amount);
    expect(containsBytes(publicByteValues(state), sim.nonce)).toBe(false);
    expect(containsBytes(publicByteValues(state), sim.ownerSecret)).toBe(false);
    expect(containsBytes(publicByteValues(state), sim.bidderSecret)).toBe(false);
  });

  it('blinds equal bids: same amount, different nonce, different commitment', () => {
    const id = bytes32('auction-7');
    const amount = 100n;

    const a = new AuctionSimulator(amount, secret(0x01), secret(0x11), secret(0xa1));
    a.createAuction(id);
    a.commitBid(id, bytes32('bidder-a'));
    const commitmentA = Array.from(a.ledger().bids)[0][1];

    const b = new AuctionSimulator(amount, secret(0x02), secret(0x12), secret(0xa2));
    b.createAuction(id);
    b.commitBid(id, bytes32('bidder-b'));
    const commitmentB = Array.from(b.ledger().bids)[0][1];

    expect(Buffer.from(commitmentA).equals(Buffer.from(commitmentB))).toBe(false);
  });

  it('accepts a reveal that opens the committed bid', () => {
    const id = bytes32('auction-reveal');
    const bidder = bytes32('bidder-a');
    sim.amount = 40n;
    sim.createAuction(id);
    sim.commitBid(id, bidder);
    expect(() => sim.revealBid(id, bidder)).toThrow(/reveal phase is closed/);
    sim.closeBidding(id);

    sim.revealBid(id, bidder);

    const state = sim.ledger();
    expect(state.revealedCounts.lookup(id)).toBe(1n);
    expect(state.bidRevealed.size()).toBe(1n);
    expect(state.winningBid.lookup(id)).toBe(40n);
    expect(Buffer.from(state.winningBidder.lookup(id)).equals(Buffer.from(bidder))).toBe(true);
    expect(state.auctionPhase.lookup(id)).toBe(PHASE_REVEAL);
  });

  it('rejects a reveal that does not match the commitment', () => {
    const id = bytes32('auction-mismatch');
    const bidder = bytes32('bidder-a');
    sim.amount = 40n;
    sim.createAuction(id);
    sim.commitBid(id, bidder);
    sim.closeBidding(id);

    sim.amount = 41n;
    expect(() => sim.revealBid(id, bidder)).toThrow(/reveal does not match commitment/);
    expect(sim.ledger().revealedCounts.lookup(id)).toBe(0n);
    expect(sim.ledger().winningBid.isEmpty()).toBe(true);
  });

  it('rejects a reveal from someone who does not hold the bidder secret', () => {
    const id = bytes32('auction-not-your-bid');
    const bidder = bytes32('bidder-a');
    sim.createAuction(id);
    sim.commitBid(id, bidder);
    sim.closeBidding(id);

    sim.bidderSecret = secret(0xee);
    expect(() => sim.revealBid(id, bidder)).toThrow(/not your bid/);
  });

  it('selects the lowest revealed bid and keeps higher amounts off the ledger', () => {
    const id = bytes32('auction-winner');
    const high = bytes32('bidder-high');
    const low = bytes32('bidder-low');
    const mid = bytes32('bidder-mid');
    sim.createAuction(id);

    sim.amount = 100n;
    sim.nonce = secret(0x01);
    sim.bidderSecret = secret(0xa1);
    sim.commitBid(id, high);

    sim.amount = 40n;
    sim.nonce = secret(0x02);
    sim.bidderSecret = secret(0xa2);
    sim.commitBid(id, low);

    sim.amount = 70n;
    sim.nonce = secret(0x03);
    sim.bidderSecret = secret(0xa3);
    sim.commitBid(id, mid);

    sim.closeBidding(id);

    // Reveal the expensive bid first, then the winner, then a bid in between.
    sim.amount = 100n;
    sim.nonce = secret(0x01);
    sim.bidderSecret = secret(0xa1);
    sim.revealBid(id, high);

    sim.amount = 40n;
    sim.nonce = secret(0x02);
    sim.bidderSecret = secret(0xa2);
    sim.revealBid(id, low);

    sim.amount = 70n;
    sim.nonce = secret(0x03);
    sim.bidderSecret = secret(0xa3);
    sim.revealBid(id, mid);

    const state = sim.ledger();
    expect(state.revealedCounts.lookup(id)).toBe(3n);
    expect(state.winningBid.lookup(id)).toBe(40n);
    expect(Buffer.from(state.winningBidder.lookup(id)).equals(Buffer.from(low))).toBe(true);
    // 100 was the leader only until 40 replaced it, so it is gone from current
    // state. 70 never led, so it was never written. 40 is the public price.
    const numbers = publicNumbers(state);
    expect(numbers).toContain(40n);
    expect(numbers).not.toContain(70n);
    expect(numbers).not.toContain(100n);
    expect(containsBytes(publicByteValues(state), secret(0x03))).toBe(false);

    sim.finalizeAuction(id);
    expect(sim.ledger().auctionPhase.lookup(id)).toBe(PHASE_FINAL);
    expect(sim.ledger().winningBid.lookup(id)).toBe(40n);
    expect(() => sim.revealBid(id, high)).toThrow();
  });

  it('keeps the earlier reveal when two bids tie for lowest', () => {
    const id = bytes32('auction-tie');
    const first = bytes32('bidder-first');
    const second = bytes32('bidder-second');
    sim.createAuction(id);

    sim.amount = 15n;
    sim.nonce = secret(0x31);
    sim.bidderSecret = secret(0xb1);
    sim.commitBid(id, first);

    sim.amount = 15n;
    sim.nonce = secret(0x32);
    sim.bidderSecret = secret(0xb2);
    sim.commitBid(id, second);

    sim.closeBidding(id);
    sim.amount = 15n;
    sim.nonce = secret(0x31);
    sim.bidderSecret = secret(0xb1);
    sim.revealBid(id, first);
    sim.nonce = secret(0x32);
    sim.bidderSecret = secret(0xb2);
    sim.revealBid(id, second);

    expect(Buffer.from(sim.ledger().winningBidder.lookup(id)).equals(Buffer.from(first))).toBe(true);
  });

  it('rejects close and finalize from anyone but the owner', () => {
    const id = bytes32('auction-owner');
    const bidder = bytes32('bidder-a');
    sim.ownerSecret = secret(0x11);
    sim.createAuction(id);
    sim.commitBid(id, bidder);

    sim.ownerSecret = secret(0x5a);
    expect(() => sim.closeBidding(id)).toThrow(/not the auction owner/);
    expect(sim.ledger().auctionPhase.lookup(id)).toBe(PHASE_BIDDING);

    sim.ownerSecret = secret(0x11);
    sim.closeBidding(id);
    expect(() => sim.finalizeAuction(id)).toThrow(/no revealed bids/);
    sim.revealBid(id, bidder);

    sim.ownerSecret = secret(0x5a);
    expect(() => sim.finalizeAuction(id)).toThrow(/not the auction owner/);
    expect(sim.ledger().auctionPhase.lookup(id)).toBe(PHASE_REVEAL);

    sim.ownerSecret = secret(0x11);
    sim.finalizeAuction(id);
    expect(sim.ledger().auctionPhase.lookup(id)).toBe(PHASE_FINAL);
  });
});
