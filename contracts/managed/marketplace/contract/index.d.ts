import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  intentRequirements(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  agentCapabilityProof(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  callerAddress(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  submitIntent(context: __compactRuntime.CircuitContext<PS>,
               intentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  matchIntent(context: __compactRuntime.CircuitContext<PS>,
              intentId_0: Uint8Array,
              agentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  cancelIntent(context: __compactRuntime.CircuitContext<PS>,
               intentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  submitIntent(context: __compactRuntime.CircuitContext<PS>,
               intentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  matchIntent(context: __compactRuntime.CircuitContext<PS>,
              intentId_0: Uint8Array,
              agentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  cancelIntent(context: __compactRuntime.CircuitContext<PS>,
               intentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  submitIntent(context: __compactRuntime.CircuitContext<PS>,
               intentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  matchIntent(context: __compactRuntime.CircuitContext<PS>,
              intentId_0: Uint8Array,
              agentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  cancelIntent(context: __compactRuntime.CircuitContext<PS>,
               intentId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  intents: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  matches: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array[];
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array[]]>
  };
  readonly intentCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
