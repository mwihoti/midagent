/**
 * Client helpers for the ScamShield fraud registry (contracts/fraud-registry).
 *
 * Secrets (issuer / reporter) are stored in local private state and handed to
 * the wallet's proving provider at proof time, which sees them in clear; the only values that ever reach the chain are the ones
 * the contract discloses: a reporter commitment at enrollment, and the Merkle
 * root, nullifier and target at report time.
 */
import { ensureRandomSecret, hasSecret, scopedName } from './privateState';
import { CONTRACTS } from './compiledContract';
import { normalizeKenyanMsisdn, targetBytes } from './scamShield';

type FraudRegistryModule = {
  ledger: (state: any) => any;
  pureCircuits: {
    reporterCommitment(sk: Uint8Array): Uint8Array;
    targetKey(target: Uint8Array): Uint8Array;
  };
};

function loadModule(): Promise<FraudRegistryModule> {
  return CONTRACTS['fraud-registry'].load();
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Parse a 32-byte hex value (as handed over by a member), tolerating 0x and spaces. */
export function parseHex32(input: string): Uint8Array {
  const hex = input.trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('A reporter commitment is 64 hexadecimal characters (32 bytes).');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Normalise a user-entered Kenyan number and build the contract's 32-byte
 * target encoding. Throws a user-facing error for invalid input.
 */
export function phoneTarget(input: string): { msisdn: string; target: Uint8Array } {
  const msisdn = normalizeKenyanMsisdn(input);
  if (!msisdn) {
    throw new Error(
      `"${input}" is not a valid Kenyan mobile number. Use a form like 0712 345 678 or +254 712 345 678.`,
    );
  }
  return { msisdn, target: targetBytes(msisdn) };
}

/** Local storage key of this browser's reporter secret for one registry. */
export function reporterSecretName(registryAddress: string): string {
  return scopedName('reporterSecret', registryAddress);
}

/** Local storage key of this browser's issuer secret for one registry. */
export function issuerSecretName(registryAddress: string): string {
  return scopedName('issuerSecret', registryAddress);
}

/** Whether this browser holds a reporter secret for `registryAddress`. */
export function hasReporterSecret(registryAddress: string): boolean {
  return hasSecret(reporterSecretName(registryAddress));
}

/** Whether this browser holds the issuer secret for `registryAddress`. */
export function hasIssuerSecret(registryAddress: string): boolean {
  return hasSecret(issuerSecretName(registryAddress));
}

/**
 * This browser's reporter commitment for ONE registry, as hex. Creates a
 * random reporter secret for that registry on first use. Each registry gets
 * its own secret, so a member of several registries has unrelated public
 * commitments in each. The member hands ONLY this commitment to the issuer;
 * the secret behind it is never published.
 */
export async function myReporterCommitment(registryAddress: string): Promise<string> {
  const sk = ensureRandomSecret(reporterSecretName(registryAddress), 32);
  const { pureCircuits } = await loadModule();
  return bytesToHex(pureCircuits.reporterCommitment(sk));
}

// Numbers this browser has already reported, per registry. A cheap guard
// against re-reporting before the first report is indexed: the local circuit
// run would pass, a proof would be built and the fee spent, and the ledger
// would then reject the transaction on its nullifier.
const REPORTED_KEY = 'scamshield-reported';

function readReported(): string[] {
  try {
    return JSON.parse(localStorage.getItem(REPORTED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function reportedId(registryAddress: string, msisdn: string): string {
  return `${scopedName('report', registryAddress)}:${msisdn}`;
}

/** Whether this browser has already reported `msisdn` to this registry. */
export function alreadyReportedHere(registryAddress: string, msisdn: string): boolean {
  return readReported().includes(reportedId(registryAddress, msisdn));
}

/** Remember that this browser reported `msisdn` to this registry. */
export function rememberReport(registryAddress: string, msisdn: string): void {
  const all = readReported();
  const id = reportedId(registryAddress, msisdn);
  if (all.includes(id)) return;
  all.push(id);
  try {
    localStorage.setItem(REPORTED_KEY, JSON.stringify(all));
  } catch {
    // Best effort only; the on-chain nullifier check is what actually enforces it.
  }
}

export interface RegistryLookup {
  msisdn: string;
  count: bigint;
  totalReports: bigint;
  reporterCount: bigint;
  /** Whether this browser's reporter commitment is enrolled (null if no secret yet). */
  meEnrolled: boolean | null;
}

/** Read the registry's public state from the indexer and decode it. */
async function readLedger(publicDataProvider: any, contractAddress: string) {
  const mod = await loadModule();
  const state = await publicDataProvider.queryContractState(contractAddress);
  if (!state) {
    throw new Error(
      'No ScamShield registry found at that address on this network (or the indexer has not seen it yet).',
    );
  }
  return { mod, ledger: mod.ledger(state.data) };
}

/**
 * Public lookup: how many verified, de-duplicated reports a number has. Reads
 * only public state — no proof, no transaction, no secret involved.
 */
export async function lookupNumber(
  publicDataProvider: any,
  contractAddress: string,
  phone: string,
  myCommitmentHex: string | null,
): Promise<RegistryLookup> {
  const { msisdn, target } = phoneTarget(phone);
  const { mod, ledger } = await readLedger(publicDataProvider, contractAddress);
  const key = mod.pureCircuits.targetKey(target);
  const count: bigint = ledger.reportCounts.member(key)
    ? ledger.reportCounts.lookup(key)
    : 0n;
  return {
    msisdn,
    count,
    totalReports: ledger.totalReports,
    reporterCount: ledger.reporterCount,
    meEnrolled: myCommitmentHex
      ? ledger.enrolled.member(parseHex32(myCommitmentHex))
      : null,
  };
}

/**
 * Public number of enrolled reporters: the upper bound on a report's anonymity
 * set (a report hides WHICH of these members made it, nothing more).
 */
export async function enrolledReporterCount(
  publicDataProvider: any,
  contractAddress: string,
): Promise<bigint> {
  const { ledger } = await readLedger(publicDataProvider, contractAddress);
  return ledger.reporterCount;
}

/** Whether a given commitment is already enrolled (pre-check before a tx). */
export async function isEnrolled(
  publicDataProvider: any,
  contractAddress: string,
  commitmentHex: string,
): Promise<boolean> {
  const { ledger } = await readLedger(publicDataProvider, contractAddress);
  return ledger.enrolled.member(parseHex32(commitmentHex));
}

function errorText(err: any): string {
  const parts: string[] = [];
  let cur = err;
  for (let i = 0; cur && i < 5; i++) {
    if (typeof cur === 'string') parts.push(cur);
    else if (cur.message) parts.push(String(cur.message));
    cur = cur.cause;
  }
  if (parts.length === 0) parts.push(String(err));
  return parts.join(' | ');
}

/** Map contract assertion failures and witness errors to plain language. */
export function friendlyRegistryError(err: any): string {
  const text = errorText(err);
  if (/already reported this number/i.test(text)) {
    return 'You have already reported this number from this device. Each verified member can report a given number once.';
  }
  if (/reporter already enrolled/i.test(text)) {
    return 'That reporter commitment is already enrolled in this registry.';
  }
  if (/not the issuer/i.test(text) || /No issuerSecret stored/i.test(text)) {
    return "Only the organisation that deployed this registry can enroll reporters, and it must use the same browser that deployed it (the issuer secret lives there).";
  }
  if (
    /not enrolled/i.test(text) ||
    /path is not for this reporter/i.test(text) ||
    /No reporterSecret stored/i.test(text)
  ) {
    return "You are not enrolled in this registry yet. Copy your reporter commitment above and give it to the registry's issuer (your community group, SACCO or NGO) to enroll you.";
  }
  if (/rejected on-chain/i.test(text)) {
    return `The network rejected this transaction, so nothing was recorded. If you just made the same report or enrollment, the first one is probably still being confirmed; look the number up again in a minute. (${text})`;
  }
  return text || 'Request failed';
}
