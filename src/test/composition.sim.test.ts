/**
 * In-process tests for the Composition contract.
 *
 * Privacy properties under test: the workflow DAG definition and each step's
 * output are private witnesses; public state may only hold commitments to them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CircuitContext } from '@midnight-ntwrk/compact-runtime';

import { Contract, ledger, type Ledger } from '../../contracts/composition/index.js';
import { bytes32, secret, initContext } from './helpers/simulator.js';

const WORKFLOW_DAG = secret(0xe1);
const STEP_OUTPUT = secret(0xe2);

class CompositionSimulator {
  private contract: Contract<Record<string, never>>;
  private context: CircuitContext<Record<string, never>>;

  constructor() {
    this.contract = new Contract({
      workflowDefinition: (ctx: any) => [ctx.privateState, WORKFLOW_DAG],
      stepOutput: (ctx: any) => [ctx.privateState, STEP_OUTPUT],
    });
    this.context = initContext(this.contract, {});
  }

  registerWorkflow(id: Uint8Array): void {
    this.context = this.contract.impureCircuits.registerWorkflow(this.context, id).context;
  }

  completeStep(id: Uint8Array, stepIndex: bigint): void {
    this.context = this.contract.impureCircuits.completeStep(
      this.context,
      id,
      stepIndex,
    ).context;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}

describe('Composition', () => {
  let sim: CompositionSimulator;

  beforeEach(() => {
    sim = new CompositionSimulator();
  });

  it('starts with no workflows', () => {
    expect(sim.ledger().workflows.isEmpty()).toBe(true);
  });

  it('registers a workflow', () => {
    const id = bytes32('wf-1');
    sim.registerWorkflow(id);
    expect(sim.ledger().workflows.member(id)).toBe(true);
  });

  it('rejects completing a step on an unknown workflow', () => {
    expect(() => sim.completeStep(bytes32('missing'), 0n)).toThrow();
  });

  it('records step completion against a registered workflow', () => {
    const id = bytes32('wf-2');
    sim.registerWorkflow(id);
    sim.completeStep(id, 0n);

    expect(sim.ledger().workflowState.member(id)).toBe(true);
  });

  it('NEVER exposes the workflow definition in public state', () => {
    const id = bytes32('wf-3');
    sim.registerWorkflow(id);

    const stored = sim.ledger().workflows.lookup(id);
    expect(Buffer.from(stored).equals(Buffer.from(WORKFLOW_DAG))).toBe(false);
  });

  it('NEVER exposes a step output in public state', () => {
    const id = bytes32('wf-4');
    sim.registerWorkflow(id);
    sim.completeStep(id, 0n);

    const stored = sim.ledger().workflowState.lookup(id);
    expect(Buffer.from(stored).equals(Buffer.from(STEP_OUTPUT))).toBe(false);
  });
});
