import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  bidAmount(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  bidNonce(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  createAuction(context: __compactRuntime.CircuitContext<PS>,
                auctionId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitBid(context: __compactRuntime.CircuitContext<PS>,
            auctionId_0: Uint8Array,
            bidderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>,
               auctionId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  createAuction(context: __compactRuntime.CircuitContext<PS>,
                auctionId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitBid(context: __compactRuntime.CircuitContext<PS>,
            auctionId_0: Uint8Array,
            bidderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>,
               auctionId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  createAuction(context: __compactRuntime.CircuitContext<PS>,
                auctionId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  commitBid(context: __compactRuntime.CircuitContext<PS>,
            auctionId_0: Uint8Array,
            bidderId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  closeBidding(context: __compactRuntime.CircuitContext<PS>,
               auctionId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  auctionPhase: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  bids: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  bidCounts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  readonly auctionCount: bigint;
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
