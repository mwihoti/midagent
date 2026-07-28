# Product Proposal — Confidential Credentials

**Chosen idea (from the Level 3 list):** _Confidential Credentials — prove a
credential is valid without disclosing it._

## One-liner

An on-chain **agent registry** where each agent holds a private **capability
credential**. The agent proves it holds a valid credential — and can later prove
ownership of it — **without ever revealing the credential itself**.

## Why this idea, on this codebase

The Level 1–2 dApp already centers on the agent registry, and the registry is a
textbook confidential-credential primitive:

- A credential (the agent's capabilities) is issued/known off-chain.
- Registration publishes only a **commitment** to it.
- Ownership is proven by demonstrating knowledge of the credential behind the
  commitment — the credential stays private.

So rather than bolt on an unrelated feature, Level 3 sharpens the existing
contract into a proper confidential-credential scheme.

## What changed for Level 3

The original `registerAgent` did `agents.insert(agentId, disclose(caps))` — it
stored the raw capabilities in **public** state. A unit test caught this. The
contract now stores `persistentHash(capabilities)`:

```compact
export circuit registerAgent(agentId: Bytes<32>): [] {
  const caps = agentCapabilities();                 // private witness
  const commitment = persistentHash<Bytes<32>>(caps);
  agents.insert(disclose(agentId), disclose(commitment)); // only the commitment is public
  agentCount = disclose((agentCount + 1) as Uint<64>);
}

export circuit proveOwnership(agentId: Bytes<32>): [] {
  assert(agents.member(disclose(agentId)), "agent not found");
  const caps = agentCapabilities();
  const commitment = persistentHash<Bytes<32>>(caps);
  assert(agents.lookup(disclose(agentId)) == disclose(commitment),
         "capabilities do not match commitment");
}
```

## Selective disclosure — what's public vs private

| Public (on-chain) | Private (never leaves the client) |
|---|---|
| That an agent exists (`agentCount`) | The agent's actual capabilities |
| The agent id | The mapping from credential → real-world meaning |
| A **commitment** (hash) of the capabilities | The pre-image of that commitment |
| That someone proved ownership | Which capabilities were used to prove it |

## User flow (the demo)

1. Connect a Midnight wallet (1AM or Lace).
2. Deploy the Agent Registry contract to Preprod.
3. **Register an agent** — enter a public agent id and its private capabilities.
   The capabilities are kept in local private state and supplied as a ZK witness;
   the chain records only `persistentHash(capabilities)`. This is the "proven,
   not shown" moment.
4. **Prove ownership** — the circuit re-derives the commitment from the locally
   held capabilities and asserts it matches what is on-chain, proving knowledge
   of the credential without revealing it.

## Success criteria

- Registration and ownership work end-to-end from the browser. ✅ (frontend)
- The capability value is provably absent from public state. ✅ (unit test)
- Tests + CI enforce the privacy property on every push. ✅
