# Midnight AI Agent Marketplace

[![CI](https://github.com/mwihoti/midagent/actions/workflows/ci.yml/badge.svg)](https://github.com/mwihoti/midagent/actions/workflows/ci.yml)

> **Level 3 focus — Confidential Credentials.** Agents hold a private capability
> credential and prove it's valid (and that they own it) without ever revealing
> it. See [`PROPOSAL.md`](./PROPOSAL.md) and [Privacy model](#privacy-model).

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

Four Compact contracts model the marketplace:

| Contract | Circuits | Purpose |
|----------|----------|---------|
| `agent-registry.compact` | `registerAgent`, `proveOwnership` | Register agents behind a capability commitment; prove ownership with ZK |
| `marketplace.compact` | `submitIntent`, `matchIntent`, `cancelIntent` | Shielded intent matching |
| `payments.compact` | `createEscrow`, `releaseEscrow`, `cancelEscrow`, `createSubscription`, `revokeSubscription` | Hybrid escrow + subscription payments |
| `composition.compact` | `registerWorkflow`, `completeStep`, `cancelWorkflow` | DAG workflows that chain agents |

A React DApp (`demo/`) drives the whole thing from the browser: connect a
wallet, deploy any of the four contracts, and call a circuit — with the wallet
doing the proving, dust-fee balancing, and submission.

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

**2. A cold wallet sync will OOM your process.**
The wallet SDK syncs the shielded + dust history from genesis **in memory**.
On Preprod (~1.8M blocks) that blew past Node's 4 GB heap at ~20% and crashed
(`JavaScript heap out of memory`). Fix: a dust-fee deploy doesn't need the
shielded wallet at all, so I stop the shielded subsystem right after startup
(`stopShielded`). Memory drops from *climbing-to-19 GB* to a bounded ~200–900 MB,
and only the (much lighter) dust subsystem keeps syncing.

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

What an **observer of the chain** can and cannot learn about a registered agent:

| An observer **can** see | An observer **cannot** see |
|---|---|
| That an agent exists, and the total `agentCount` | The agent's capabilities (what it actually does) |
| The agent id used as the map key | The pre-image behind the capability commitment |
| A `persistentHash` **commitment** of the capabilities | Any way to invert that commitment back to the value |
| That an ownership proof succeeded | Which capability value satisfied the proof |

The capabilities enter the circuit as a Compact `witness` and are committed with
`persistentHash` — the commitment is public, the value never is. `proveOwnership`
re-derives the commitment from the witness and asserts equality, so ownership is
demonstrated **without disclosure**. This is enforced by a test that asserts the
raw capabilities are absent from public state (see below).

> Earlier the contract stored `disclose(caps)` — i.e. the capabilities in the
> clear. That was a real privacy bug; the unit test caught it and the fix (store
> the commitment) is what makes the disclosure genuinely selective.

## Tests

Fast, deterministic tests run the compiled circuits in-process via the
compact-runtime simulator — no devnet, no proof server — so CI stays quick and
reliable (`src/test/agent-registry.sim.test.ts`).

```bash
yarn test:unit
```

```
✓ starts empty with an agent count of zero
✓ registers an agent and records its commitment publicly
✓ tracks multiple distinct agents
✓ lets the owner prove ownership without a revert
✓ NEVER exposes the raw capabilities in public state (the privacy property)

Test Files  1 passed (1)
     Tests  5 passed (5)
```

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
yarn deploy:preprod                  # the real target; registers dust, waits, deploys
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

**Preprod:** `<PREPROD_ADDRESS_HERE>`  — explorer:
`https://explorer.preprod.midnight.network/contract/<PREPROD_ADDRESS_HERE>`
<!-- Fill in after `yarn deploy:preprod` (or the DApp Deploy button on preprod) lands. -->

---

## Submission checklist (Level 3)

- [x] Fully functional dApp that meaningfully uses Midnight's privacy model
- [x] Chosen idea from the list — **Confidential Credentials** ([`PROPOSAL.md`](./PROPOSAL.md))
- [x] ≥ 3 tests passing (5 unit tests, `yarn test:unit`)
- [x] CI/CD pipeline (workflow file + badge above)
- [x] README "privacy model" section (what an observer can/cannot learn)
- [x] ≥ 10 meaningful commits
- [ ] Live demo link — `<VERCEL_URL_HERE>`
- [ ] Preprod contract address (verifiable) — see [Deployed contracts](#deployed-contracts)
- [ ] Screenshot: test output (3+ passing)
- [ ] Demo video (~1 min) showing full functionality
- [ ] Product proposal submitted for approval (from [`PROPOSAL.md`](./PROPOSAL.md))

---

## Project structure

```
agent/
├── contracts/                # Compact sources + compiled output (contracts/managed/)
├── src/                       # CLI: network config, wallet provider, deploy + inspection tools
│   ├── config.ts             # Preview / Preprod / local network configs
│   ├── wallet.ts             # provider: build, dust registration, bounded-memory sync
│   └── deploy-testnet.ts     # deploy all four, register dust, wait, submit
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
