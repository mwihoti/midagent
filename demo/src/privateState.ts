/**
 * Local private state.
 *
 * Witness values (an agent's capabilities, a buyer's requirements, …) are the
 * secrets behind the on-chain commitments. They must never be sent to the chain,
 * but they DO need to survive between circuit calls: `proveOwnership` only
 * succeeds if it re-derives the exact same commitment that `registerAgent`
 * stored, which means feeding it the exact same capability bytes.
 *
 * So we keep them here, in the browser, persisted to localStorage. This is the
 * client-side half of Midnight's privacy model — the chain holds commitments,
 * this holds the pre-images.
 */

const STORAGE_KEY = 'midnight-agent-private-state';

type SecretMap = Record<string, string>; // name -> hex

function readAll(): SecretMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeAll(map: SecretMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private browsing, quota). Secrets then live only for
    // this page session, which still works for a single register→prove flow.
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out;
}

/**
 * Pack a UTF-8 string into a fixed-width byte array, the form the contracts use
 * for ids and witness values. Previously duplicated inline in App.tsx.
 */
export function toFixedBytes(text: string, size = 32): Uint8Array {
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(text).slice(0, size));
  return out;
}

/** Store a secret under `name`. Stays on this device. */
export function setSecret(name: string, value: Uint8Array): void {
  const all = readAll();
  all[name] = toHex(value);
  writeAll(all);
}

/** Store a secret derived from user-entered text. */
export function setSecretFromText(name: string, text: string, size = 32): void {
  setSecret(name, toFixedBytes(text, size));
}

/**
 * Generate and store a cryptographically random secret — used for blinding
 * nonces. The nonce must be unpredictable (a guessable nonce lets an observer
 * brute-force a small bid space against the public commitment) and must persist
 * locally, because opening the commitment later requires the exact same nonce.
 */
export function setRandomSecret(name: string, size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  setSecret(name, bytes);
  return bytes;
}

/**
 * Read a secret. Returns zeroes if nothing was stored — a deploy never invokes
 * witnesses, so that path is harmless; a circuit call with no stored secret will
 * simply fail its commitment check, which is the correct behaviour.
 */
export function getSecret(name: string, size = 32): Uint8Array {
  const stored = readAll()[name];
  if (!stored) return new Uint8Array(size);
  const bytes = fromHex(stored);
  if (bytes.length === size) return bytes;
  const out = new Uint8Array(size);
  out.set(bytes.slice(0, size));
  return out;
}

/** Whether a secret has been captured yet (drives UI gating). */
export function hasSecret(name: string): boolean {
  return Boolean(readAll()[name]);
}

/** Forget every stored secret. */
export function clearSecrets(): void {
  writeAll({});
  writeRecords({ owners: {}, bids: {} });
  writeNumbers({});
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

const NUMBERS_KEY = 'midnight-agent-numeric-secrets';
const AUCTION_RECORDS_KEY = 'midnight-agent-auction-records';

type NumberMap = Record<string, string>;

type BidRecord = { amount: string; nonce: string; secret: string };

type AuctionRecords = {
  owners: Record<string, string>;
  bids: Record<string, BidRecord>;
};

function readNumbers(): NumberMap {
  try {
    return JSON.parse(localStorage.getItem(NUMBERS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeNumbers(map: NumberMap): void {
  try {
    localStorage.setItem(NUMBERS_KEY, JSON.stringify(map));
  } catch {
    // Same as writeAll: a single session still works if storage is blocked.
  }
}

function emptyRecords(): AuctionRecords {
  return { owners: {}, bids: {} };
}

function readRecords(): AuctionRecords {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUCTION_RECORDS_KEY) ?? '{}');
    return {
      owners: parsed.owners ?? {},
      bids: parsed.bids ?? {},
    };
  } catch {
    return emptyRecords();
  }
}

function writeRecords(records: AuctionRecords): void {
  try {
    localStorage.setItem(AUCTION_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Secrets then live only in the witness slots set just below.
  }
}

function bidKey(auctionId: string, bidderId: string): string {
  return JSON.stringify([auctionId, bidderId]);
}

/** Whole-number bid, in token units, as a Compact Uint<64>. */
export function parseBidAmount(text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Bid amount must be a whole number (0 or greater), with no decimals.');
  }
  const amount = BigInt(trimmed);
  const max = (1n << 64n) - 1n;
  if (amount > max) {
    throw new Error('Bid amount does not fit in a 64-bit unsigned integer.');
  }
  return amount;
}

export function setNumericSecret(name: string, value: bigint): void {
  const all = readNumbers();
  all[name] = value.toString();
  writeNumbers(all);
}

export function getNumericSecret(name: string): bigint {
  const stored = readNumbers()[name];
  if (!stored || !/^\d+$/.test(stored)) return 0n;
  return BigInt(stored);
}

/**
 * Decode a fixed-width public id back into the text the user typed.
 * Trailing zero padding from `toFixedBytes` is dropped.
 */
export function bytesToText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder().decode(bytes.slice(0, end));
}

/**
 * Create the buyer secret for an auction and arm the `ownerSecret` witness.
 * Stored per auction id so this browser can close and finalize later, and so
 * a second auction does not overwrite the first key.
 */
export function saveAuctionOwner(auctionId: string): void {
  const secret = randomBytes(32);
  const records = readRecords();
  records.owners[auctionId] = toHex(secret);
  writeRecords(records);
  setSecret('ownerSecret', secret);
}

export function hasAuctionOwner(auctionId: string): boolean {
  return Boolean(readRecords().owners[auctionId]);
}

/** Copy the stored buyer secret into the witness slot. False if we never opened it. */
export function activateOwner(auctionId: string): boolean {
  const hex = readRecords().owners[auctionId];
  if (!hex) return false;
  setSecret('ownerSecret', fromHex(hex));
  return true;
}

/**
 * Remember a sealed bid and arm the amount / nonce / bidder-secret witnesses.
 * The nonce and bidder secret are random: the nonce blinds the commitment,
 * and the bidder secret is what `revealBid` will demand later.
 */
export function saveSealedBid(auctionId: string, bidderId: string, amount: bigint): void {
  const nonce = randomBytes(32);
  const secret = randomBytes(32);
  const records = readRecords();
  records.bids[bidKey(auctionId, bidderId)] = {
    amount: amount.toString(),
    nonce: toHex(nonce),
    secret: toHex(secret),
  };
  writeRecords(records);
  setNumericSecret('bidAmount', amount);
  setSecret('bidNonce', nonce);
  setSecret('bidderSecret', secret);
}

export function hasSealedBid(auctionId: string, bidderId: string): boolean {
  return Boolean(readRecords().bids[bidKey(auctionId, bidderId)]);
}

export function sealedBidAmount(auctionId: string, bidderId: string): string | null {
  return readRecords().bids[bidKey(auctionId, bidderId)]?.amount ?? null;
}

/** Copy one stored bid into the witness slots `revealBid` reads. */
export function activateBid(auctionId: string, bidderId: string): boolean {
  const record = readRecords().bids[bidKey(auctionId, bidderId)];
  if (!record) return false;
  setNumericSecret('bidAmount', BigInt(record.amount));
  setSecret('bidNonce', fromHex(record.nonce));
  setSecret('bidderSecret', fromHex(record.secret));
  return true;
}
