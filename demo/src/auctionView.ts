import type { StateValue } from '@midnight-ntwrk/compact-runtime';
import { bytesToText, toFixedBytes } from './privateState';

export type AuctionView = {
  found: boolean;
  phase: bigint | null;
  phaseLabel: string;
  bidCount: bigint;
  revealedCount: bigint;
  winnerPseudonym: string | null;
  winningAmount: bigint | null;
};

const PHASE_LABELS: Record<string, string> = {
  '1': 'Bidding open',
  '2': 'Reveal',
  '3': 'Finalized',
};

/**
 * Read the public auction record from the indexer. The winning amount is
 * public; losing amounts are not on the ledger, so they cannot be shown here.
 */
export async function readAuctionView(
  publicDataProvider: { queryContractState: (address: string) => Promise<unknown> },
  contractAddress: string,
  auctionIdText: string,
): Promise<AuctionView> {
  const state = await publicDataProvider.queryContractState(contractAddress);
  if (!state) {
    throw new Error(
      'The indexer has no state for this contract yet. Wait for the last transaction to finalize, then read again.',
    );
  }

  const { ledger } = await import('../../contracts/managed/auction/contract/index.js');
  const stateValue =
    typeof state === 'object' && state !== null && 'data' in state
      ? (state as { data: unknown }).data
      : state;
  const view = ledger(stateValue as StateValue);
  const id = toFixedBytes(auctionIdText);

  if (!view.auctionPhase.member(id)) {
    return {
      found: false,
      phase: null,
      phaseLabel: 'Not opened',
      bidCount: 0n,
      revealedCount: 0n,
      winnerPseudonym: null,
      winningAmount: null,
    };
  }

  const phase = view.auctionPhase.lookup(id) as bigint;
  const hasWinner = view.winningBidder.member(id) as boolean;
  return {
    found: true,
    phase,
    phaseLabel: PHASE_LABELS[phase.toString()] ?? `Phase ${phase.toString()}`,
    bidCount: view.bidCounts.lookup(id) as bigint,
    revealedCount: view.revealedCounts.lookup(id) as bigint,
    winnerPseudonym: hasWinner ? bytesToText(view.winningBidder.lookup(id)) : null,
    winningAmount: hasWinner ? (view.winningBid.lookup(id) as bigint) : null,
  };
}
