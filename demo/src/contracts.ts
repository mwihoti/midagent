function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

function ensureHex(value: any): string {
  if (typeof value === 'string') {
    return value.startsWith('0x') ? value.slice(2) : value;
  }
  if (value instanceof Uint8Array || Array.isArray(value)) {
    return toHex(new Uint8Array(value));
  }
  if (value?.hex) return ensureHex(value.hex);
  if (value?.bytes) return ensureHex(value.bytes);
  return String(value);
}

// The SDK's WalletProvider expects getCoinPublicKey()/getEncryptionPublicKey() to
// be SYNCHRONOUS (they return the key directly, not a Promise). We therefore
// pre-fetch the wallet's shielded keys before building the provider.
async function fetchShieldedKeys(walletApi: any) {
  const addrs = await walletApi.getShieldedAddresses();
  return {
    coinPublicKey: ensureHex(addrs.shieldedCoinPublicKey),
    encryptionPublicKey: ensureHex(addrs.shieldedEncryptionPublicKey),
  };
}

function makeWalletProvider(
  walletApi: any,
  keys: { coinPublicKey: string; encryptionPublicKey: string },
) {
  return {
    getCoinPublicKey: () => keys.coinPublicKey,
    getEncryptionPublicKey: () => keys.encryptionPublicKey,
    balanceTx: async (tx: any) => {
      const txHex = toHex(tx.serialize());
      const balanced = await walletApi.balanceUnsealedTransaction(txHex);
      if (!balanced?.tx) throw new Error('balanceUnsealedTransaction failed');
      const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        fromHex(balanced.tx),
      );
    },
  };
}

function makeMidnightProvider(walletApi: any) {
  return {
    submitTx: async (tx: any) => {
      const txHex = toHex(tx.serialize());
      const result = await walletApi.submitTransaction(txHex);
      if (typeof result === 'string' && result) return result;
      if (result?.transactionId) return result.transactionId;
      return txHex.slice(0, 64);
    },
  };
}

function makeProofProvider(provingProvider: any) {
  return {
    proveTx: async (unprovenTx: any, _config: any) => {
      const { CostModel } = await import('@midnight-ntwrk/ledger-v8');
      return unprovenTx.prove(provingProvider, CostModel.initialCostModel());
    },
  };
}

// Local private-state store. Contract private state and signing keys are kept
// on the client only — never sent on-chain — which is the whole point of the
// private-state provider. Backed by an in-memory Map (per session).
const privateStates = new Map<string, unknown>();
const signingKeys = new Map<string, unknown>();

function makePrivateStateProvider() {
  return {
    setContractAddress: () => Promise.resolve(),
    set: (id: string, state: unknown) => {
      privateStates.set(id, state);
      return Promise.resolve();
    },
    get: (id: string) => Promise.resolve(privateStates.get(id) ?? null),
    remove: (id: string) => {
      privateStates.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      privateStates.clear();
      return Promise.resolve();
    },
    setSigningKey: (id: string, key: unknown) => {
      signingKeys.set(id, key);
      return Promise.resolve();
    },
    getSigningKey: (id: string) => Promise.resolve(signingKeys.get(id) ?? null),
    removeSigningKey: (id: string) => {
      signingKeys.delete(id);
      return Promise.resolve();
    },
    clearSigningKeys: () => {
      signingKeys.clear();
      return Promise.resolve();
    },
    exportPrivateStates: () =>
      Promise.resolve(Object.fromEntries(privateStates) as any),
    importPrivateStates: (states: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(states)) privateStates.set(k, v);
      return Promise.resolve();
    },
    exportSigningKeys: () =>
      Promise.resolve(Object.fromEntries(signingKeys) as any),
    importSigningKeys: (keys: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(keys)) signingKeys.set(k, v);
      return Promise.resolve();
    },
  };
}

export async function deployContract(
  session: any,
  walletApi: any,
  compiledContract: any,
) {
  const provingProvider = await walletApi.getProvingProvider(
    session.zkConfigProvider,
  );

  const { createUnprovenDeployTx } = await import(
    '@midnight-ntwrk/midnight-js-contracts'
  );

  const { sampleSigningKey } = await import('@midnight-ntwrk/compact-runtime');

  const keys = await fetchShieldedKeys(walletApi);

  const deployTxData = await createUnprovenDeployTx(
    {
      zkConfigProvider: session.zkConfigProvider,
      // Cast: the wallet does the actual balancing/signing, so our provider's
      // balanceTx returns a wallet-balanced tx that the SDK's stricter
      // FinalizedTransaction type doesn't line up with structurally.
      walletProvider: makeWalletProvider(walletApi, keys) as any,
    } as any,
    {
      compiledContract,
      args: [],
      signingKey: sampleSigningKey(),
    },
  );

  const contractAddress = deployTxData.public.contractAddress;

  const provenTx = await deployTxData.private.unprovenTx.prove(
    provingProvider,
    (await import('@midnight-ntwrk/ledger-v8')).CostModel.initialCostModel(),
  );

  const balancedHex = await walletApi.balanceUnsealedTransaction(
    toHex(provenTx.serialize()),
  );
  if (!balancedHex?.tx) throw new Error('Balance failed after prove');

  const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
  const finalTx = Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    fromHex(balancedHex.tx),
  );

  const txId = await walletApi.submitTransaction(toHex(finalTx.serialize()));
  console.log('Deploy tx submitted:', txId);

  return { contractAddress, txId };
}

export async function callCircuit(
  session: any,
  walletApi: any,
  compiledContract: any,
  contractAddress: string,
  circuitId: string,
  args: any[],
) {
  const provingProvider = await walletApi.getProvingProvider(
    session.zkConfigProvider,
  );

  const { createUnprovenCallTx } = await import(
    '@midnight-ntwrk/midnight-js-contracts'
  );

  const keys = await fetchShieldedKeys(walletApi);

  const callTxData = await createUnprovenCallTx(
    {
      privateStateProvider: makePrivateStateProvider(),
      publicDataProvider: session.publicDataProvider,
      zkConfigProvider: session.zkConfigProvider,
      proofProvider: makeProofProvider(provingProvider),
      walletProvider: makeWalletProvider(walletApi, keys) as any,
      midnightProvider: makeMidnightProvider(walletApi),
    } as any,
    {
      compiledContract,
      contractAddress,
      circuitId,
      args,
    },
  );

  const provenTx = await callTxData.private.unprovenTx.prove(
    provingProvider,
    (await import('@midnight-ntwrk/ledger-v8')).CostModel.initialCostModel(),
  );

  const balancedHex = await walletApi.balanceUnsealedTransaction(
    toHex(provenTx.serialize()),
  );
  if (!balancedHex?.tx) throw new Error('Balance failed');

  const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
  const finalTx = Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    fromHex(balancedHex.tx),
  );

  const txId = await walletApi.submitTransaction(toHex(finalTx.serialize()));
  console.log('Call tx submitted:', txId);

  return { txId };
}

export async function queryContractState(
  publicDataProvider: any,
  contractAddress: string,
) {
  return publicDataProvider.queryContractState(contractAddress);
}
