# Midnight AI Agent Marketplace

[![CI](https://github.com/mwihoti/midagent/actions/workflows/ci.yml/badge.svg)](https://github.com/mwihoti/midagent/actions/workflows/ci.yml)

> **Level 4 — Waxing Gibbous: the Sealed-Bid Auction MVP.** The approved idea
> from the Level 3 submission, live as a product: providers commit **blinded
> sealed bids** on-chain (`persistentCommit(amount, nonce)`), the bid set
> freezes when bidding closes, and no bid amount is ever published. See
> [The product](#the-product--sealed-bid-agent-auction),
> [`PROPOSAL.md`](./PROPOSAL.md) and [Privacy model](#privacy-model).
>
> **Follow the build:** [@MidnightAgentMkt on X](https://x.com/MidnightAgentMkt)
> <!-- TODO: replace with your real X handle URL after creating the profile -->

A privacy-preserving marketplace for AI agents, built on **Midnight**. Agents
register with their capabilities hidden behind ZK commitments, buyers match
against them without either side revealing its hand, and payments settle through
shielded escrow. Everything that *needs* to be public (counts, commitments,
state roots) is on-chain; everything that shouldn't be (capabilities, pricing,
intent) stays off-chain and is only ever *proven*, never shown.

This repo is my entry for the Midnight DApp challenge. Below is what I built,
how the pieces map to the requirements, and — because half the value is in the
gotchas — the things that actually bit me and how I got around them.

---

## What it does

Five Compact contracts model the marketplace:

| Contract | Circuits | Purpose |
|----------|----------|---------|
| `auction.compact` | `createAuction`, `commitBid`, `closeBidding` | **The product MVP** — sealed-bid auctions with blinded bid commitments |
| `agent-registry.compact` | `registerAgent`, `proveOwnership` | Register agents behind a capability commitment; prove ownership with ZK |
| `marketplace.compact` | `submitIntent`, `matchIntent`, `cancelIntent` | Shielded intent matching |
| `payments.compact` | `createEscrow`, `releaseEscrow`, `cancelEscrow`, `createSubscription`, `revokeSubscription` | Hybrid escrow + subscription payments |
| `composition.compact` | `registerWorkflow`, `completeStep`, `cancelWorkflow` | DAG workflows that chain agents |

A React DApp (`demo/`) drives the whole thing from the browser: connect a
wallet, deploy any contract, and call its circuits — with the wallet doing the
proving, dust-fee balancing, and submission.

---

## The product — Sealed-Bid Agent Auction

The MVP implements the **privacy-critical core first**: the commit phase.

A buyer opens an auction for a job. Competing agent providers commit sealed
bids: the amount and a random blinding nonce stay in the bidder's browser
(local private state), and the chain records only
`persistentCommit(amount, nonce)`. Blinding matters — bid spaces are small, so
an unblinded hash could be brute-forced, and two equal bids would be visibly
equal. With the nonce, even identical amounts produce different commitments
(there's a unit test for exactly that). When the buyer closes bidding, the
commitment set freezes; because commitments are *binding*, nobody can open
theirs to a different amount in the reveal phase (Level 5), which is what makes
the eventual winner verifiable.

**Using it (browser):** connect wallet → deploy **Sealed-Bid Auction** → in the
auction card: *Open Auction* with an id → *Commit Sealed Bid* with a public
bidder pseudonym and a **private** amount → *Close Bidding*. Watch the ledger:
bid count goes up, no amount ever appears.

**Phases:** `1` = bidding open, `2` = closed. Reveal + verifiable winner +
escrow settlement are Level 5 scope; hardening is Level 6 (see
[`PROPOSAL.md`](./PROPOSAL.md)).

---

## How it maps to the challenge

| Requirement | Where it lives |
|---|---|
| **Connect / disconnect the wallet** | `demo/src/wallet.ts`, `demo/src/App.tsx` — detects every injected Midnight wallet (1AM **and** Lace), lets you pick one, connect, and disconnect |
| **Call a circuit from the frontend, handle the result** | `registerAgent` in `demo/src/contracts.ts` (`callCircuit`) — builds the unproven tx → proves → balances the dust fee → submits → returns a tx id shown in the UI |
| **Observable privacy (proven, not shown)** | The agent's capabilities are a Compact `witness`. When you register, the circuit proves they match the on-chain commitment **without the value ever leaving the browser**. The public ledger only gains a commitment and an incremented count |
| **Manage local private state** | `makePrivateStateProvider` in `demo/src/contracts.ts` — a client-side store for contract private state and signing keys; it never touches the chain |
| **Deploy to Preprod with a verifiable address** | `src/deploy-testnet.ts` (`yarn deploy:preprod`) or the DApp's Deploy button; see [Deployed contracts](#deployed-contracts) |

### Public vs private, concretely

In Compact, state splits two ways:

- **`ledger`** state is public — `agentCount`, commitments, hashes. Everyone can
  see *that* an agent exists and how many there are.
- **`witness`** data is private — supplied off-chain, fed into a circuit, proven,
  and discarded. `agentCapabilities` is a witness: the provider proves their
  capabilities hash matches their registered commitment, but the capabilities
  themselves are never published.

That split is the whole point — public state gives you consensus and
verifiability, witnesses keep the business logic (pricing, model details, buyer
intent) shielded.

---

## The parts that actually fought back

I'm leaving these in because they're the real story of shipping on a young
privacy chain, and future-me (and anyone forking this) will want them.

**1. NIGHT doesn't pay fees — DUST does, and DUST isn't free.**
On Preprod/Preview you can't just hold NIGHT and transact. You have to *register*
your NIGHT UTXOs for DUST generation with an on-chain transaction, then wait for
DUST to accrue. The deploy script does this automatically
(`registerForDustGeneration` in `src/wallet.ts`): build the registration recipe,
`finalizeRecipe`, submit, then poll until there's spendable DUST. Gotcha within
the gotcha: the registration tx must **not** go through `signRecipe` — it carries
its own dust-registration signature and has no unshielded spend, so signing it
corrupts it and the node rejects it.

**2. A cold wallet sync will OOM your process — and on Preprod, no flag saves it.**
The wallet SDK syncs the shielded + dust history from genesis **in memory**.
On Preprod (~1.9M blocks) that blew past Node's 4 GB heap and crashed
(`JavaScript heap out of memory`). Stopping the shielded subsystem right after
startup (`stopShielded`) helps — a dust-fee deploy doesn't need it — but the
honest end of this story is that it only delays the crash: the dust subsystem
itself retains per-index state, and a later run still hit the 4 GB limit at
just **6%** of the dust sync. (Low RSS had me thinking memory was bounded; it
wasn't — the growing heap was quietly being paged to swap.) Extrapolated, a
cold CLI sync of today's Preprod needs on the order of 60 GB of heap. So:
`yarn deploy:preprod` works on a big-memory machine (or on the much smaller
Preview chain — `yarn deploy:preview` completes in minutes), but the supported
path to Preprod on ordinary hardware is the **DApp**: browser wallets keep a
persistent, disk-backed synced state, so deploying from the UI sidesteps the
cold sync entirely.

**3. `Custom error 170` on submit = version mismatch, not your code.**
That's `InvalidDustSpendProof` — the node rejected the **dust fee proof**. The
proof server that generates it has to match `@midnight-ntwrk/ledger-v8`. The
`:latest` proof-server image was 8.1.0 against ledger 8.0.3; pinning the proof
server to 8.0.3 (`proof-server.yml`) fixed it.

**4. Sync time scales with chain size — pick your network accordingly.**
Preview is ~17× smaller than Preprod, so a cold sync there is minutes, not hours.
Great for iterating; the DApp exposes a network switch so you can develop on
Preview and submit on Preprod.

---

## Privacy model

Every private value in this system is a Compact `witness`. It is fed into a
circuit, committed with `persistentHash`, and **only the commitment is written to
the chain**. What an observer can and cannot learn, per contract:

| Contract | An observer **can** see | An observer **cannot** see |
|---|---|---|
| `auction` | An auction exists and its phase; how many bids were committed; the blinded commitments | Any bid amount; whether two bids are equal; the blinding nonces |
| `agent-registry` | An agent exists; `agentCount`; its id; a commitment of its capabilities; that an ownership proof succeeded | The capabilities themselves, or which value satisfied the proof |
| `marketplace` | An intent exists; `intentCount`; that a match happened; which agent id was matched | The buyer's requirements, or the matcher's address |
| `payments` | An escrow or subscription exists | Its terms — amount, payer, payee |
| `composition` | A workflow exists; that a step completed | The DAG definition, or any step's output |

`proveOwnership` is the clearest demonstration: it re-derives
`persistentHash(capabilities)` from the private witness held in the browser and
asserts equality against the on-chain commitment. Succeeding proves you hold the
right capabilities **without transmitting them**.

The secrets live in [`demo/src/privateState.ts`](./demo/src/privateState.ts) —
client-side, persisted to `localStorage`, never sent anywhere. The chain holds
commitments; that store holds the pre-images.

> **This was a real bug, not a hypothetical.** Every contract originally wrote its
> raw witness straight into public state (`agents.insert(id, disclose(caps))` and
> four more sites across marketplace/payments/composition — including
> `callerAddress()`, which de-anonymized whoever matched an intent). A unit test
> caught the first one; auditing the rest found four more. Storing commitments
> instead is what makes the disclosure genuinely selective, and there is now a
> test per contract asserting the raw witness never appears on-chain.

### Known limitation

`marketplace.verifyCapabilityProof()` returns `true` unconditionally — it is a
placeholder, not a security control, and is commented as such in the source. Real
verification requires checking the proof against the agent-registry commitment via
a cross-contract read, which is not wired up yet.

## Tests

Fast, deterministic tests run the compiled circuits in-process via the
compact-runtime simulator — no devnet, no proof server — so CI stays quick and
reliable (`src/test/agent-registry.sim.test.ts`).

```bash
yarn test:unit
```

```
✓ src/test/auction.sim.test.ts       (9 tests)
✓ src/test/agent-registry.sim.test.ts (5 tests)
✓ src/test/marketplace.sim.test.ts   (6 tests)
✓ src/test/payments.sim.test.ts      (6 tests)
✓ src/test/composition.sim.test.ts   (6 tests)

Test Files  5 passed (5)
     Tests  32 passed (32)
```

Every contract has a test asserting its private witness never reaches public
state — e.g. *"NEVER exposes the bid amount or nonce in public state"*. The
auction suite also proves the **blinding property**: two bidders committing the
same amount produce different on-chain commitments, so equal bids are
indistinguishable. Those are the regression guards for the disclosure bug
described above.

The heavier end-to-end tests (`src/test/*.test.ts`) run against a local devnet
via `yarn env:up && yarn test:local`.

## CI/CD

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every push and
PR to `master`/`main`:

- **test** — installs deps and runs the contract unit tests (`yarn test:unit`).
- **build** — type-checks and production-builds the DApp (`npm run build`), a
  real compile step over the frontend + generated contract bindings.

The badge at the top reflects the latest run.

## Running it

### Prerequisites
- Node.js 22+
- Docker (proof server / local devnet)
- The Compact compiler (`compact` CLI)
- A Midnight wallet extension (1AM or Lace) for the DApp

### Contracts + CLI

```bash
yarn install
yarn compile                         # compiles all four contracts to contracts/managed/

cp .env.example .env                 # add your MIDNIGHT_PREPROD_MNEMONIC (never commit this)
docker compose -f proof-server.yml up -d   # proof server, pinned to ledger 8.0.3

yarn deploy:preview                  # fast: deploys all four to Preview
yarn deploy:preprod                  # needs a big-RAM machine (see gotcha #2); on a laptop, deploy to Preprod from the DApp instead
yarn inspect:preview                 # print wallet address + NIGHT balance
```

Local tests against a Docker devnet:

```bash
yarn env:up && yarn test:local && yarn env:down   # or: yarn validate
```

### Frontend DApp

```bash
cd demo
npm install
npm run sync:zk    # copy all four contracts' ZK keys/zkir into public/contract/
npm run dev        # http://localhost:5173
```

Pick a **wallet** and **network**, Connect, then Deploy a contract and Register
an Agent. No local proof server needed for the DApp — the wallet does the
proving. Deploying the site: it's a static SPA (`demo/vercel.json` included); on
Vercel set the project **Root Directory** to `demo`.

---

## Deployed contracts

Deployed and verifiable on **Midnight Preview** (`deployments/preview.json`):

| Contract | Address |
|----------|---------|
| AgentRegistry | `2c7e31c539ac26b2e720ccf113e420377b8c630b6130df2dc55c90942a4556aa` |
| Marketplace | `8d9612cf80c65e655fe625f68a9e9bf2e1279340265cd0946fab3439532a7656` |
| Payments | `fbcae9578c9ede02c6347b1c019ac5bccde5b6fc15a7d4af25c1865fc8db2d0f` |
| Composition | `21f43e89ffc37b388772acbd592c88d406e30728494da1a8bd0872370598ca7a` |

> Explorer: `https://explorer.preview.midnight.network/contract/<address>`
> Note: these Preview addresses predate the privacy fix (commit `0304874`) and
> the auction contract — they are kept for provenance, not as the live MVP.

### Preprod (the Level 4 MVP)

Deployed from the DApp (browser wallet pays the dust fee; see gotcha #2 for why the CLI route needs a big-memory machine):

| Contract | Address |
|----------|---------|
| Auction (MVP) | `<PREPROD_AUCTION_ADDRESS>` |
| AgentRegistry | `<PREPROD_REGISTRY_ADDRESS>` |

> Explorer: `https://explorer.preprod.midnight.network/contract/<address>`
<!-- Fill from deployments/preprod.json when the in-flight deploy lands. -->

---

## Submission checklist (Level 4)

- [ ] Working MVP live on Preprod (verifiable address) — deploy in flight, see
      [Deployed contracts](#deployed-contracts)
- [x] Documentation — README + setup ([Running it](#running-it)) + usage
      ([The product](#the-product--sealed-bid-agent-auction))
- [x] CI/CD pipeline on the repo (workflow + badge above)
- [ ] Product X profile — placeholder linked at the top; create the account and
      swap in the real URL
- [x] ≥ 15 meaningful commits (40+)
- [ ] Live demo link — `<VERCEL_URL_HERE>`
- [ ] Demo video of the MVP

---

## Project structure

```
agent/
├── contracts/                # Compact sources + compiled output (contracts/managed/)
├── src/                       # CLI: network config, wallet provider, deploy + inspection tools
│   ├── config.ts             # Preview / Preprod / local network configs
│   ├── wallet.ts             # provider: build, dust registration, bounded-memory sync
│   └── deploy-testnet.ts     # deploy all five, register dust, wait, submit
├── demo/                      # React DApp
│   └── src/
│       ├── wallet.ts         # multi-wallet detect + connect/disconnect
│       ├── contracts.ts      # deploy + circuit call + local private-state provider
│       └── compiledContract.ts
├── proof-server.yml           # proof server pinned to ledger 8.0.3
└── package.json
```

## Tech stack

Midnight `wallet-sdk-facade` 3.0.0 · `ledger-v8` 8.0.3 · `midnight-js` 4.0.4 ·
`compact-runtime` 0.16.0 · React 19 + Vite · TypeScript.

## License

MIT
