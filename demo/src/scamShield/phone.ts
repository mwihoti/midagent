/**
 * Kenyan phone-number (MSISDN) helpers for ScamShield.
 *
 * Canonical form is E.164 without the leading '+': "2547XXXXXXXX" or
 * "2541XXXXXXXX" (12 digits). This is the exact form the fraud-registry
 * contract expects inside its `reportScam(target)` input, so a number typed as
 * "0712 345 678", "+254-712-345-678" or "(0712) 345678" always maps to the
 * same on-chain target and the same per-target report counter.
 *
 * Browser-only, dependency-free.
 */

/** Characters allowed in a raw phone-number string before normalisation. */
const ALLOWED_CHARS = /^[+\d\s\-().]+$/;

/**
 * Mobile subscriber part after the country code: 7XXXXXXXX, or an assigned
 * 1-series range: 100-108, 110-119, 120/124/126/128, 130 and 140-146 (CA
 * Numbering Plan, April 2026), plus 180-182 (released by Safaricom, Aug 2026).
 */
const SUBSCRIBER = '(7\\d{8}|1(?:0[0-8]|1\\d|2[0468]|30|4[0-6]|8[0-2])\\d{6})';

/**
 * Normalise a Kenyan mobile number to "2547XXXXXXXX" / "2541XXXXXXXX".
 *
 * Accepts: 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, 1XXXXXXXX, +2547XXXXXXXX,
 * 2547XXXXXXXX (and the 1-series equivalents), with optional spaces, dashes,
 * dots and parentheses. Only the assigned 1-series ranges (see SUBSCRIBER)
 * are accepted. A '+' is only accepted at the
 * very start and only in front of the 254 country code. Anything else (landlines, short codes,
 * foreign numbers, letters, "+0712…", "25407…") returns null.
 */
export function normalizeKenyanMsisdn(input: string): string | null {
  const raw = input.trim();
  if (raw.length === 0 || !ALLOWED_CHARS.test(raw)) return null;

  const plusCount = (raw.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !raw.startsWith('+'))) return null;

  const digits = raw.replace(/\D/g, '');
  if (plusCount === 1 && !digits.startsWith('254')) return null;

  let m = new RegExp(`^254${SUBSCRIBER}$`).exec(digits);
  if (m) return `254${m[1]}`;
  if (plusCount === 1) return null;

  m = new RegExp(`^0${SUBSCRIBER}$`).exec(digits);
  if (m) return `254${m[1]}`;

  m = new RegExp(`^${SUBSCRIBER}$`).exec(digits);
  if (m) return `254${m[1]}`;

  return null;
}

/**
 * Candidate phone-number spans inside free text. Deliberately permissive about
 * separators (spaces, dashes, parentheses, dots) and strict about digit counts
 * and boundaries, so numbers embedded in longer digit runs, transaction codes
 * or amounts are not picked up. In free text a 0, 254 or +254 prefix is
 * REQUIRED: a bare 9-digit run ("Ksh 1 500 000", "account 712345678") is far
 * more often an amount or account number than a phone number. (Bare 9-digit
 * numbers are still accepted by normalizeKenyanMsisdn for numbers the user
 * types into a single-number field.) Every candidate is re-validated with
 * normalizeKenyanMsisdn.
 */
const PHONE_CANDIDATE =
  /(?<![\w+])(?:\+?254|0)[\s\-().]{0,3}[17](?:[\s\-().]{0,2}\d){8}(?!\d)/g;

/** Every Kenyan mobile number in `text`, normalised, de-duplicated, in order of first appearance. */
export function extractPhoneNumbers(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(PHONE_CANDIDATE)) {
    const n = normalizeKenyanMsisdn(match[0]);
    if (n !== null) seen.add(n);
  }
  return [...seen];
}

/** Byte length of the contract's `target: Bytes<32>` input. */
export const TARGET_BYTES_LENGTH = 32;

/**
 * Encode a phone number as the fraud-registry contract's `reportScam` /
 * lookup target: the UTF-8 bytes of "msisdn:" + normalised number, zero-padded
 * to 32 bytes. Accepts any form normalizeKenyanMsisdn accepts; throws on an
 * invalid number so a typo can never be reported on-chain.
 */
export function targetBytes(msisdn: string): Uint8Array {
  const normalized = normalizeKenyanMsisdn(msisdn);
  if (normalized === null) {
    throw new Error(`Not a valid Kenyan mobile number: "${msisdn}"`);
  }
  const encoded = new TextEncoder().encode(`msisdn:${normalized}`);
  // "msisdn:" (7) + 12 digits = 19 bytes, always <= 32.
  const out = new Uint8Array(TARGET_BYTES_LENGTH);
  out.set(encoded);
  return out;
}
