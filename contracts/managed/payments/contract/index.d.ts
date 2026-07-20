import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum PaymentType { PER_CALL = 0, SUBSCRIPTION = 1, OUTCOME_BASED = 2 }

export type Witnesses<PS> = {
  escrowDetails(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  subscriptionDetails(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  createEscrow(context: __compactRuntime.CircuitContext<PS>,
               escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  releaseEscrow(context: __compactRuntime.CircuitContext<PS>,
                escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  cancelEscrow(context: __compactRuntime.CircuitContext<PS>,
               escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  createSubscription(context: __compactRuntime.CircuitContext<PS>,
                     subId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeSubscription(context: __compactRuntime.CircuitContext<PS>,
                     subId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  createEscrow(context: __compactRuntime.CircuitContext<PS>,
               escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  releaseEscrow(context: __compactRuntime.CircuitContext<PS>,
                escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  cancelEscrow(context: __compactRuntime.CircuitContext<PS>,
               escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  createSubscription(context: __compactRuntime.CircuitContext<PS>,
                     subId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeSubscription(context: __compactRuntime.CircuitContext<PS>,
                     subId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  createEscrow(context: __compactRuntime.CircuitContext<PS>,
               escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  releaseEscrow(context: __compactRuntime.CircuitContext<PS>,
                escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  cancelEscrow(context: __compactRuntime.CircuitContext<PS>,
               escrowId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  createSubscription(context: __compactRuntime.CircuitContext<PS>,
                     subId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeSubscription(context: __compactRuntime.CircuitContext<PS>,
                     subId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  escrows: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  subscriptions: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
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
