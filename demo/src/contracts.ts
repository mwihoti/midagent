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

  const deployTxData = await createUnprovenDeployTx(
    {
      zkConfigProvider: session.zkConfigProvider,
      walletProvider: {
        getCoinPublicKey: () =>
          walletApi.getShieldedAddresses().then((r: any) => r.shieldedCoinPublicKey),
        getEncryptionPublicKey: () =>
          walletApi.getShieldedAddresses().then((r: any) => r.shieldedEncryptionPublicKey),
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
      },
    },
    {
      compiledContract,
      args: [],
      signingKey: (await import('@midnight-ntwrk/compact-runtime')).sampleSigningKey(),
    },
  );

  const contractAddress = deployTxData.public.contractAddress;

  const txHex = toHex(
    deployTxData.private.unprovenTx.serialize(),
  );

  const proofProvider = {
    async proveTx(unprovenTx: any, _config: any) {
      const { CostModel } = await import('@midnight-ntwrk/ledger-v8');
      return unprovenTx.prove(provingProvider, CostModel.initialCostModel());
    },
  };

  const provenTx = await proofProvider.proveTx(
    deployTxData.private.unprovenTx,
    null,
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

  const callTxData = await createUnprovenCallTx(
    {
      privateStateProvider: {
        setContractAddress: () => Promise.resolve(),
        set: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        remove: () => Promise.resolve(),
        clear: () => Promise.resolve(),
        setSigningKey: () => Promise.resolve(),
        getSigningKey: () => Promise.resolve(null),
        removeSigningKey: () => Promise.resolve(),
        clearSigningKeys: () => Promise.resolve(),
        exportPrivateStates: () => Promise.resolve({} as any),
        importPrivateStates: () => Promise.resolve(),
        exportSigningKeys: () => Promise.resolve({} as any),
        importSigningKeys: () => Promise.resolve(),
      },
      publicDataProvider: session.publicDataProvider,
      zkConfigProvider: session.zkConfigProvider,
      proofProvider: {
        proveTx: async (unprovenTx: any, _config: any) => {
          const { CostModel } = await import('@midnight-ntwrk/ledger-v8');
          return unprovenTx.prove(provingProvider, CostModel.initialCostModel());
        },
      },
      walletProvider: {
        getCoinPublicKey: () =>
          walletApi.getShieldedAddresses().then((r: any) => r.shieldedCoinPublicKey),
        getEncryptionPublicKey: () =>
          walletApi.getShieldedAddresses().then((r: any) => r.shieldedEncryptionPublicKey),
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
      },
      midnightProvider: {
        submitTx: async (tx: any) => {
          const txHex = toHex(tx.serialize());
          const result = await walletApi.submitTransaction(txHex);
          if (typeof result === 'string' && result) return result;
          if (result?.transactionId) return result.transactionId;
          return txHex.slice(0, 64);
        },
      },
    },
    {
      compiledContract,
      contractAddress,
      circuitId,
      args,
    },
  );

  return callTxData;
}

export async function queryContractState(
  publicDataProvider: any,
  contractAddress: string,
) {
  const state = await publicDataProvider.queryContractState(contractAddress);
  return state;
}
