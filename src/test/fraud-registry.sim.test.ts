/**
 * In-process tests for the ScamShield fraud registry.
 *
 * Privacy properties under test:
 *   * Only the issuer (holder of the issuer secret) can enroll reporters.
 *   * A report proves membership in the reporter tree WITHOUT revealing which
 *     member reported: the reporter secret, its commitment's position and the
 *     Merkle path stay private; only a historic root, a nullifier and the
 *     target key are published.
 *   * One report per (reporter, target): same pair collides on the nullifier,
 *     but the same reporter's reports of different targets are unlinkable
 *     (unrelated nullifiers), and so are reports of the same target in
 *     different registries (the nullifier is bound to the contract address).
 *   * Neither the reporter secret nor the issuer secret ever reaches public
 *     state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContractState,
  type CircuitContext,
  type MerkleTreePath,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger,
  pureCircuits,
  reporterPathFromLedger,
  type Ledger,
} from '../../contracts/fraud-registry/index.js';
import { bytes32, secret, initContext, containsBytes } from './helpers/simulator.js';

type PS = Record<string, never>;

const ISSUER_SECRET = secret(0xa1);
const ALICE = secret(0x11);
const BOB = secret(0x22);
const CAROL = secret(0x33);
const MALLORY = secret(0x66); // never enrolled

const SCAMMER_1 = bytes32('msisdn:254712345678');
const SCAMMER_2 = bytes32('msisdn:254798765432');

/** Concatenate every Uint8Array found anywhere inside `value`. */
function flattenBytes(value: unknown): Uint8Array {
  const parts: Uint8Array[] = [];
  const walk = (v: unknown): void => {
    if (v instanceof Uint8Array) parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return Buffer.concat(parts);
}

/**
 * Drives the contract with mutable "who am I" fields, so one deployed instance
 * can be called by the issuer and several reporters in turn — exactly as
 * different wallets would call one deployed contract.
 */
class FraudRegistrySimulator {
  private contract: Contract<PS>;
  context: CircuitContext<PS>;
  issuerSecret: Uint8Array;
  reporterSecret: Uint8Array = new Uint8Array(32);
  /** When set, the reporterPath witness returns this instead of a fresh path. */
  pathOverride: MerkleTreePath<Uint8Array> | undefined;

  constructor(issuerSecret = ISSUER_SECRET) {
    this.issuerSecret = issuerSecret;
    this.contract = new Contract<PS>({
      issuerSecret: (ctx) => [ctx.privateState, this.issuerSecret],
      reporterSecret: (ctx) => [ctx.privateState, this.reporterSecret],
      reporterPath: (ctx, leaf) => [
        ctx.privateState,
        this.pathOverride ?? reporterPathFromLedger(ctx.ledger, leaf),
      ],
    });
    this.context = initContext(this.contract, {} as PS);
  }

  enroll(commitment: Uint8Array, asIssuer = this.issuerSecret): void {
    const saved = this.issuerSecret;
    this.issuerSecret = asIssuer;
    try {
      this.context = this.contract.impureCircuits.enrollReporter(
        this.context,
        commitment,
      ).context;
    } finally {
      this.issuerSecret = saved;
    }
  }

  enrollMember(sk: Uint8Array): void {
    this.enroll(pureCircuits.reporterCommitment(sk));
  }

  /** Public transcript + inputs of the last report: what the proof publishes. */
  lastReportPublic: Uint8Array = new Uint8Array();
  /** Private witness outputs of the last report: what stays on the device. */
  lastReportPrivate: Uint8Array = new Uint8Array();
  /** Encoded reporterPath witness output of the last report. */
  lastReportPathOutputs: Uint8Array[] = [];

  report(sk: Uint8Array, target: Uint8Array): void {
    this.reporterSecret = sk;
    const r = this.contract.impureCircuits.reportScam(this.context, target);
    this.context = r.context;
    this.lastReportPublic = flattenBytes([
      r.proofData.input,
      r.proofData.publicTranscript,
      r.proofData.output,
    ]);
    this.lastReportPrivate = flattenBytes(r.proofData.privateTranscriptOutputs);
    this.lastReportPathOutputs = r.proofData.privateTranscriptOutputs[1].value;
  }

  /** This instance's contract address (the registry the nullifier is bound to). */
  address(): string {
    return String(this.context.currentQueryContext.address);
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  /** Serialized public state — what any chain observer can see. */
  publicBytes(): Uint8Array {
    const cs = new ContractState();
    cs.data = this.context.currentQueryContext.state;
    return cs.serialize();
  }

  count(target: Uint8Array): bigint {
    const key = pureCircuits.targetKey(target);
    const l = this.ledger();
    return l.reportCounts.member(key) ? l.reportCounts.lookup(key) : 0n;
  }

  nullifierSet(): string[] {
    return Array.from(this.ledger().nullifiers, (n) => Buffer.from(n).toString('hex'));
  }
}

describe('FraudRegistry (ScamShield anonymous scam reports)', () => {
  let sim: FraudRegistrySimulator;

  beforeEach(() => {
    sim = new FraudRegistrySimulator();
  });

  it('starts empty, with the issuer key derived from (not equal to) the issuer secret', () => {
    const state = sim.ledger();
    expect(state.reporterCount).toBe(0n);
    expect(state.totalReports).toBe(0n);
    expect(state.nullifiers.isEmpty()).toBe(true);
    expect(state.reportCounts.isEmpty()).toBe(true);
    expect(Buffer.from(state.issuerKey).equals(Buffer.from(ISSUER_SECRET))).toBe(false);
    expect(state.issuerKey.some((b) => b !== 0)).toBe(true);
  });

  it('pure circuits are deterministic and domain-separated', () => {
    const c1 = pureCircuits.reporterCommitment(ALICE);
    const c2 = pureCircuits.reporterCommitment(ALICE);
    expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(true);
    // Same 32 input bytes under different purposes must hash differently.
    expect(
      Buffer.from(pureCircuits.reporterCommitment(ALICE)).equals(
        Buffer.from(pureCircuits.targetKey(ALICE)),
      ),
    ).toBe(false);
  });

  it('issuer enrolls a reporter: count and tree both update', () => {
    const c = pureCircuits.reporterCommitment(ALICE);
    sim.enroll(c);

    const state = sim.ledger();
    expect(state.reporterCount).toBe(1n);
    expect(state.reporters.firstFree()).toBe(1n);
    expect(state.enrolled.member(c)).toBe(true);
    expect(state.reporters.findPathForLeaf(c)).toBeDefined();
  });

  it('rejects enrollment by anyone without the issuer secret', () => {
    const c = pureCircuits.reporterCommitment(ALICE);
    expect(() => sim.enroll(c, secret(0xb2))).toThrow(/not the issuer/);
    expect(sim.ledger().reporterCount).toBe(0n);
  });

  it('rejects enrolling the same commitment twice', () => {
    const c = pureCircuits.reporterCommitment(ALICE);
    sim.enroll(c);
    expect(() => sim.enroll(c)).toThrow(/already enrolled/);
    expect(sim.ledger().reporterCount).toBe(1n);
  });

  it('an enrolled reporter can report a number', () => {
    sim.enrollMember(ALICE);
    sim.report(ALICE, SCAMMER_1);

    const state = sim.ledger();
    expect(sim.count(SCAMMER_1)).toBe(1n);
    expect(state.totalReports).toBe(1n);
    expect(state.nullifiers.size()).toBe(1n);
    expect(sim.count(SCAMMER_2)).toBe(0n);
  });

  it('rejects the same reporter reporting the same number twice', () => {
    sim.enrollMember(ALICE);
    sim.report(ALICE, SCAMMER_1);
    expect(() => sim.report(ALICE, SCAMMER_1)).toThrow(/already reported/);
    expect(sim.count(SCAMMER_1)).toBe(1n);
    expect(sim.ledger().totalReports).toBe(1n);
  });

  it('same reporter, different numbers: both accepted with unlinkable nullifiers', () => {
    sim.enrollMember(ALICE);
    sim.report(ALICE, SCAMMER_1);
    sim.report(ALICE, SCAMMER_2);

    expect(sim.count(SCAMMER_1)).toBe(1n);
    expect(sim.count(SCAMMER_2)).toBe(1n);
    expect(sim.ledger().totalReports).toBe(2n);

    const nuls = sim.nullifierSet();
    expect(nuls.length).toBe(2);
    expect(nuls[0]).not.toBe(nuls[1]);
    // Neither nullifier is (or contains) the reporter's commitment, so nothing
    // on-chain ties either report back to Alice's enrollment leaf.
    const aliceCommit = Buffer.from(pureCircuits.reporterCommitment(ALICE)).toString('hex');
    expect(nuls).not.toContain(aliceCommit);
  });

  it('same secret, same number, two registries: nullifiers are unrelated (no cross-registry linkage)', () => {
    // Two independent deployments (different sampleContractAddress() values),
    // with Alice enrolled in both under the SAME secret.
    const other = new FraudRegistrySimulator();
    expect(other.address()).not.toBe(sim.address());
    sim.enrollMember(ALICE);
    other.enrollMember(ALICE);

    sim.report(ALICE, SCAMMER_1);
    other.report(ALICE, SCAMMER_1);

    const a = sim.nullifierSet();
    const b = other.nullifierSet();
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    // Disjoint: an observer cannot match the two reports by their nullifiers.
    expect(a.filter((n) => b.includes(n))).toEqual([]);

    // Within one registry the double-report check still holds.
    expect(() => sim.report(ALICE, SCAMMER_1)).toThrow(/already reported/);
    expect(() => other.report(ALICE, SCAMMER_1)).toThrow(/already reported/);
    expect(sim.count(SCAMMER_1)).toBe(1n);
    expect(other.count(SCAMMER_1)).toBe(1n);
  });

  it('two distinct reporters reporting the same number count twice', () => {
    sim.enrollMember(ALICE);
    sim.enrollMember(BOB);
    sim.report(ALICE, SCAMMER_1);
    sim.report(BOB, SCAMMER_1);

    expect(sim.count(SCAMMER_1)).toBe(2n);
    expect(sim.ledger().totalReports).toBe(2n);
  });

  it('rejects a report from a secret that was never enrolled', () => {
    sim.enrollMember(ALICE);
    // The honest witness cannot even find a path for Mallory's commitment.
    expect(() => sim.report(MALLORY, SCAMMER_1)).toThrow();

    // A forged path claiming Mallory's commitment as the leaf, with Alice's
    // siblings, hashes to a root the tree never had.
    const alicePath = sim.ledger().reporters.findPathForLeaf(
      pureCircuits.reporterCommitment(ALICE),
    )!;
    sim.pathOverride = { leaf: pureCircuits.reporterCommitment(MALLORY), path: alicePath.path };
    expect(() => sim.report(MALLORY, SCAMMER_1)).toThrow(/not enrolled/);
    expect(sim.count(SCAMMER_1)).toBe(0n);
  });

  it("rejects a valid path for SOMEONE ELSE's leaf", () => {
    sim.enrollMember(ALICE);
    // Mallory obtains Alice's (public) leaf path, but cannot claim it: the
    // circuit recomputes the leaf from Mallory's own secret.
    sim.pathOverride = sim.ledger().reporters.findPathForLeaf(
      pureCircuits.reporterCommitment(ALICE),
    );
    expect(() => sim.report(MALLORY, SCAMMER_1)).toThrow(/path is not for this reporter/);
    expect(sim.count(SCAMMER_1)).toBe(0n);
  });

  it('accepts a path built against an OLDER root (historic tree)', () => {
    sim.enrollMember(ALICE);
    const stalePath = sim.ledger().reporters.findPathForLeaf(
      pureCircuits.reporterCommitment(ALICE),
    )!;
    const staleRoot = sim.ledger().reporters.root();

    // More members are enrolled after Alice built her proof inputs.
    sim.enrollMember(BOB);
    sim.enrollMember(CAROL);
    expect(sim.ledger().reporters.root().field).not.toBe(staleRoot.field);
    expect(sim.ledger().reporters.checkRoot(staleRoot)).toBe(true);

    sim.pathOverride = stalePath;
    sim.report(ALICE, SCAMMER_1);
    expect(sim.count(SCAMMER_1)).toBe(1n);
  });

  it("a report's public transcript reveals the nullifier but not the secret, commitment or path", () => {
    sim.enrollMember(ALICE);
    sim.enrollMember(BOB);
    sim.report(ALICE, SCAMMER_1);

    const aliceCommit = pureCircuits.reporterCommitment(ALICE);
    const nullifier = Array.from(sim.ledger().nullifiers)[0];

    // Positive controls: the private witness transcript holds Alice's secret,
    // and the public transcript holds the nullifier and target key.
    expect(containsBytes(sim.lastReportPrivate, ALICE)).toBe(true);
    expect(containsBytes(sim.lastReportPublic, nullifier)).toBe(true);
    expect(containsBytes(sim.lastReportPublic, pureCircuits.targetKey(SCAMMER_1))).toBe(true);

    // Self-check of the leak detector: Alice's commitment ends in 0x00, which
    // the runtime encoding drops, yet it must still be found where it IS public
    // (the enrolled set / tree leaves). Otherwise the negative check below
    // would pass vacuously.
    expect(aliceCommit[31]).toBe(0);
    expect(containsBytes(sim.publicBytes(), aliceCommit)).toBe(true);

    // What must stay private.
    expect(containsBytes(sim.lastReportPublic, ALICE)).toBe(false);
    expect(containsBytes(sim.lastReportPublic, aliceCommit)).toBe(false);

    // The Merkle path: its non-zero sibling fields (the second witness output,
    // laid out as [leaf, sibling, goes_left, sibling, goes_left, ...]) are on
    // the device, never in the public transcript. Leaking them would reveal
    // the reporter's leaf position, i.e. WHICH member reported.
    const [leaf, ...rest] = sim.lastReportPathOutputs;
    // Layout sanity check (the encoding drops trailing zero bytes).
    expect(Buffer.from(aliceCommit).subarray(0, leaf.length).equals(Buffer.from(leaf))).toBe(true);
    const siblings = rest.filter((v, i) => i % 2 === 0 && v.length > 0);
    expect(siblings.length).toBeGreaterThan(0); // Bob's leaf hash, at least
    for (const s of siblings) {
      expect(containsBytes(sim.lastReportPrivate, s)).toBe(true);
      expect(containsBytes(sim.lastReportPublic, s)).toBe(false);
    }
  });

  it('NEVER exposes the reporter secret or the issuer secret in public state', () => {
    sim.enrollMember(ALICE);
    sim.enrollMember(BOB);
    sim.report(ALICE, SCAMMER_1);
    sim.report(BOB, SCAMMER_1);
    sim.report(ALICE, SCAMMER_2);

    const state = sim.ledger();
    const published: Uint8Array[] = [
      state.issuerKey,
      ...Array.from(state.enrolled),
      ...Array.from(state.nullifiers),
      ...Array.from(state.reportCounts, ([k]) => k),
    ];
    for (const value of published) {
      for (const s of [ISSUER_SECRET, ALICE, BOB]) {
        expect(containsBytes(value, s)).toBe(false);
      }
    }

    const serialized = sim.publicBytes();
    // Positive control: published values DO show up in the serialization, so
    // the negative checks below are meaningful.
    expect(containsBytes(serialized, state.issuerKey)).toBe(true);
    expect(containsBytes(serialized, Array.from(state.nullifiers)[0])).toBe(true);
    for (const s of [ISSUER_SECRET, ALICE, BOB]) {
      expect(containsBytes(serialized, s)).toBe(false);
    }
  });
});
