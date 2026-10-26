/**
 * Browser private-state helpers, driven with an in-memory localStorage.
 * These are what the DApp copies into Compact witnesses before commit / reveal
 * / close / finalize. A bid saved for one auction must not clobber another.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateBid,
  activateOwner,
  clearSecrets,
  getNumericSecret,
  getSecret,
  hasAuctionOwner,
  hasSealedBid,
  parseBidAmount,
  saveAuctionOwner,
  saveSealedBid,
  sealedBidAmount,
} from '../../demo/src/privateState.js';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe('auction private state', () => {
  it('rejects bid amounts that are not whole numbers', () => {
    expect(parseBidAmount('120')).toBe(120n);
    expect(parseBidAmount(' 0 ')).toBe(0n);
    expect(() => parseBidAmount('12.5')).toThrow(/whole number/);
    expect(() => parseBidAmount('-3')).toThrow(/whole number/);
    expect(() => parseBidAmount('')).toThrow(/whole number/);
  });

  it('restores the sealed bid into the witness slots used by reveal', () => {
    saveSealedBid('job-1', 'provider-7', 120n);
    expect(hasSealedBid('job-1', 'provider-7')).toBe(true);
    expect(sealedBidAmount('job-1', 'provider-7')).toBe('120');

    // A later bid on another auction overwrites the live witness slots.
    saveSealedBid('job-2', 'provider-7', 50n);
    expect(getNumericSecret('bidAmount')).toBe(50n);

    expect(activateBid('job-1', 'provider-7')).toBe(true);
    expect(getNumericSecret('bidAmount')).toBe(120n);
    const nonce = getSecret('bidNonce');
    const bidderSecret = getSecret('bidderSecret');
    expect(nonce).toHaveLength(32);
    expect(bidderSecret).toHaveLength(32);
    expect(Buffer.from(nonce).equals(Buffer.alloc(32))).toBe(false);
    expect(Buffer.from(bidderSecret).equals(Buffer.from(nonce))).toBe(false);
    expect(activateBid('job-1', 'someone-else')).toBe(false);
  });

  it('keeps each auction owner key separate from bidder secrets', () => {
    saveAuctionOwner('job-1');
    const owner1 = getSecret('ownerSecret');
    saveAuctionOwner('job-2');
    saveSealedBid('job-1', 'provider-7', 10n);

    expect(hasAuctionOwner('job-1')).toBe(true);
    expect(Buffer.from(getSecret('ownerSecret')).equals(Buffer.from(owner1))).toBe(false);
    expect(activateOwner('job-1')).toBe(true);
    expect(Buffer.from(getSecret('ownerSecret')).equals(Buffer.from(owner1))).toBe(true);
    expect(activateOwner('job-2')).toBe(true);
    expect(Buffer.from(getSecret('ownerSecret')).equals(Buffer.from(owner1))).toBe(false);
    expect(activateOwner('missing')).toBe(false);

    clearSecrets();
    expect(hasAuctionOwner('job-1')).toBe(false);
    expect(hasSealedBid('job-1', 'provider-7')).toBe(false);
    expect(getNumericSecret('bidAmount')).toBe(0n);
  });
});
