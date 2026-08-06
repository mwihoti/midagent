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
}
