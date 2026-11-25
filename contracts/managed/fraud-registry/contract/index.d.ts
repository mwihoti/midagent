import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  issuerSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reporterSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reporterPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
               leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                           path: { sibling: { field: bigint },
                                                   goes_left: boolean
                                                 }[]
                                         }];
}

export type ImpureCircuits<PS> = {
  enrollReporter(context: __compactRuntime.CircuitContext<PS>,
                 commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reportScam(context: __compactRuntime.CircuitContext<PS>, target_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  enrollReporter(context: __compactRuntime.CircuitContext<PS>,
                 commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reportScam(context: __compactRuntime.CircuitContext<PS>, target_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  reporterCommitment(sk_0: Uint8Array): Uint8Array;
  targetKey(target_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  reporterCommitment(context: __compactRuntime.CircuitContext<PS>,
                     sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  targetKey(context: __compactRuntime.CircuitContext<PS>, target_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  enrollReporter(context: __compactRuntime.CircuitContext<PS>,
                 commitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  reportScam(context: __compactRuntime.CircuitContext<PS>, target_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly issuerKey: Uint8Array;
  reporters: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  enrolled: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly reporterCount: bigint;
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  reportCounts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  readonly totalReports: bigint;
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
