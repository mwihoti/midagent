/**
 * Shared helpers for in-process circuit tests.
 *
 * These let a test run compiled Compact circuits directly through the
 * compact-runtime simulator — no devnet, no proof server, no wallet — so the
 * suite stays fast and deterministic enough for CI.
 */
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';

export const COIN_PUBLIC_KEY = '0'.repeat(64);

/** Pack a label into the 32-byte ids the contracts use as map keys. */
export function bytes32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).slice(0, 32));
  return out;
}

/** A fixed, recognisable secret so tests can assert it never reaches the chain. */
export function secret(fill: number, size = 32): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

/** Construct a contract in memory and return a circuit context to drive it. */
export function initContext<PS>(
  contract: { initialState: (ctx: any) => any },
  privateState: PS,
): CircuitContext<PS> {
  const { currentContractState, currentPrivateState, currentZswapLocalState } =
    contract.initialState(createConstructorContext(privateState, COIN_PUBLIC_KEY));

  return createCircuitContext(
    sampleContractAddress(),
    currentZswapLocalState,
    currentContractState,
    currentPrivateState,
  );
}

/**
 * True when `haystack` contains `needle` — used to prove a secret did NOT leak.
 *
 * The runtime's value encoding drops trailing zero bytes (a Bytes<32> ending in
 * 0x00 is stored as 31 bytes), so a full-width search would miss such a value
 * and make a negative ("did not leak") check pass vacuously. Search for the
 * needle with trailing zeros trimmed, and refuse needles that become too short
 * to be meaningful.
 */
export function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  let end = needle.length;
  while (end > 0 && needle[end - 1] === 0) end--;
  if (end < 8) {
    throw new Error('containsBytes: needle too short after trimming trailing zeros');
  }
  const n = needle.subarray(0, end);
  if (n.length > haystack.length) return false;
  return Buffer.from(haystack).includes(Buffer.from(n));
}
