# Midnight AI Agent Marketplace

A privacy-focused platform for buying, selling, and composing AI agents on Midnight Network.

## Features

- **Shielded Agent Registration** — Register AI agents with hidden capabilities
- **Privacy-Preserving Intent Matching** — Find agents without revealing full requirements
- **Hybrid Payments** — Per-call, subscription, and outcome-based payments (all shielded)
- **DAG-Based Composition** — Chain multiple agents in complex workflows

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `agent-registry.compact` | Store agents with commitment-based ownership |
| `marketplace.compact` | Shielded intent matching with ZK proofs |
| `payments.compact` | Escrow and subscription payments |
| `composition.compact` | DAG workflow execution |

## Quick Start

### Prerequisites

- Node.js 22+
- Docker
- Compact compiler (installed automatically)

### Setup

```bash
# Install dependencies
yarn install

# Compile contracts
yarn compile

# Start local devnet
yarn env:up

# Run tests
yarn test:local

# Tear down
yarn env:down
```

## Project Structure

```
agent/
├── contracts/
│   ├── agent-registry.compact
│   ├── marketplace.compact
│   ├── payments.compact
│   ├── composition.compact
│   └── managed/              # Compiler output
├── src/
│   ├── config.ts
│   ├── wallet.ts
│   ├── providers.ts
│   └── test/
│       ├── agent-registry.test.ts
│       ├── marketplace.test.ts
│       ├── payments.test.ts
│       └── composition.test.ts
├── compose.yml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Development

### Compile Contracts

```bash
cd contracts
compact compile agent-registry.compact managed/agent-registry
compact compile marketplace.compact managed/marketplace
compact compile payments.compact managed/payments
compact compile composition.compact managed/composition
```

### Run Tests

```bash
# Start local devnet first
yarn env:up

# Run tests
yarn test:local

# Or run specific test
MIDNIGHT_NETWORK=local NODE_OPTIONS='--experimental-vm-modules' vitest run src/test/agent-registry.test.ts
```

## Architecture

### Privacy Patterns

1. **Commitment-Based Agent Registration**
   - Agent capabilities hidden on-chain via `persistentCommit`
   - Ownership verifiable via ZK proofs

2. **Shielded Intent Matching**
   - Buyer requirements hidden via commitments
   - Capability proofs verify match without revealing details

3. **Hybrid Payment System**
   - Per-call micropayments
   - Subscription access passes
   - Outcome-based payments

4. **DAG Workflow Execution**
   - Workflow definitions hidden on-chain
   - Step completion tracked via commitments

## License

MIT
