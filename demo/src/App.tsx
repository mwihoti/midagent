import { useState, useCallback } from 'react';
import './App.css';

type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

function App() {
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('disconnected');
  const [address, setAddress] = useState<string | null>(null);
  const [walletApi, setWalletApi] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [callingCircuit, setCallingCircuit] = useState(false);
  const [txResult, setTxResult] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setWalletStatus('connecting');
    setError(null);

    try {
      const { connectWallet, createSession } = await import('./wallet');

      const { api, config, unshieldedAddress } = await connectWallet('preprod');
      const sess = createSession(config);

      setWalletApi(api);
      setSession(sess);
      setAddress(unshieldedAddress);
      setWalletStatus('connected');
    } catch (err: any) {
      console.error('Connect error:', err);
      setError(err.message || 'Failed to connect');
      setWalletStatus('error');
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    setWalletApi(null);
    setSession(null);
    setAddress(null);
    setContractAddress(null);
    setTxResult(null);
    setWalletStatus('disconnected');
    setError(null);
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!session || !walletApi) return;
    setDeploying(true);
    setError(null);

    try {
      const { getCompiledContract } = await import('./compiledContract');
      const { deployContract } = await import('./contracts');

      const compiled = await getCompiledContract();
      const result = await deployContract(session, walletApi, compiled);

      setContractAddress(result.contractAddress);
      setTxResult(`Deployed! Address: ${result.contractAddress}`);
    } catch (err: any) {
      console.error('Deploy error:', err);
      setError(err.message || 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  }, [session, walletApi]);

  const handleRegisterAgent = useCallback(async () => {
    if (!session || !walletApi || !contractAddress || !agentId) return;
    setCallingCircuit(true);
    setError(null);

    try {
      const { getCompiledContract } = await import('./compiledContract');
      const { callCircuit } = await import('./contracts');

      const compiled = await getCompiledContract();

      const agentIdBytes = new Uint8Array(32);
      const encoder = new TextEncoder();
      const idBytes = encoder.encode(agentId.padEnd(32, '\0'));
      agentIdBytes.set(idBytes.slice(0, 32));

      const callData = await callCircuit(
        session,
        walletApi,
        compiled,
        contractAddress,
        'registerAgent',
        [agentIdBytes],
      );

      const txHex = Array.from(
        callData.private.unprovenTx.serialize(),
        (b: number) => b.toString(16).padStart(2, '0'),
      ).join('');

      const provingProvider = await walletApi.getProvingProvider(
        session.zkConfigProvider,
      );

      const { CostModel } = await import('@midnight-ntwrk/ledger-v8');
      const provenTx = await callData.private.unprovenTx.prove(
        provingProvider,
        CostModel.initialCostModel(),
      );

      const balancedHex = await walletApi.balanceUnsealedTransaction(
        Array.from(provenTx.serialize(), (b: number) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      );

      if (!balancedHex?.tx) throw new Error('Balance failed');

      const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
      const finalTx = Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        Uint8Array.from(
          balancedHex.tx.match(/.{1,2}/g).map((byte: string) => parseInt(byte, 16)),
        ),
      );

      const txId = await walletApi.submitTransaction(
        Array.from(finalTx.serialize(), (b: number) =>
          b.toString(16).padStart(2, '0'),
        ).join(''),
      );

      setTxResult(`Agent registered! TxId: ${txId}`);
    } catch (err: any) {
      console.error('Call error:', err);
      setError(err.message || 'Circuit call failed');
    } finally {
      setCallingCircuit(false);
    }
  }, [session, walletApi, contractAddress, agentId]);

  return (
    <div className="app">
      <header>
        <h1>Midnight AI Agent Marketplace</h1>
        <p className="subtitle">Privacy-preserving agent registry on Midnight Network</p>
      </header>

      <main>
        <section className="card wallet-card">
          <h2>Wallet</h2>
          {walletStatus === 'disconnected' && (
            <button className="btn primary" onClick={handleConnect}>
              Connect Lace Wallet
            </button>
          )}
          {walletStatus === 'connecting' && (
            <p className="status">Connecting...</p>
          )}
          {walletStatus === 'connected' && (
            <div className="connected-info">
              <p className="address">
                <span className="label">Address:</span>
                <span className="value" title={address || ''}>
                  {address?.slice(0, 20)}...{address?.slice(-10)}
                </span>
              </p>
              <button className="btn secondary" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          )}
          {walletStatus === 'error' && (
            <div className="error-state">
              <p className="error">{error}</p>
              <button className="btn primary" onClick={handleConnect}>
                Retry
              </button>
            </div>
          )}
        </section>

        {walletStatus === 'connected' && (
          <section className="card deploy-card">
            <h2>Deploy Contract</h2>
            <p className="description">
              Deploy the Agent Registry contract to Midnight Preprod network.
            </p>
            <button
              className="btn primary"
              onClick={handleDeploy}
              disabled={deploying || !!contractAddress}
            >
              {deploying
                ? 'Deploying...'
                : contractAddress
                  ? 'Deployed'
                  : 'Deploy to Preprod'}
            </button>
            {contractAddress && (
              <div className="contract-info">
                <p>
                  <span className="label">Contract Address:</span>
                </p>
                <p className="contract-address" title={contractAddress}>
                  {contractAddress}
                </p>
                <a
                  href={`https://explorer.preprod.midnight.network/contract/${contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="explorer-link"
                >
                  View on Explorer
                </a>
              </div>
            )}
          </section>
        )}

        {walletStatus === 'connected' && contractAddress && (
          <section className="card circuit-card">
            <h2>Register Agent</h2>
            <p className="description">
              Register an AI agent on-chain. The agent capabilities are stored as
              a ZK commitment — hidden from public view but provable.
            </p>
            <div className="input-group">
              <label htmlFor="agentId">Agent ID</label>
              <input
                id="agentId"
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="e.g. my-data-analyzer"
              />
            </div>
            <button
              className="btn primary"
              onClick={handleRegisterAgent}
              disabled={callingCircuit || !agentId}
            >
              {callingCircuit ? 'Proving & Submitting...' : 'Register Agent'}
            </button>
          </section>
        )}

        {txResult && (
          <section className="card result-card">
            <h2>Transaction Result</h2>
            <p className="result">{txResult}</p>
          </section>
        )}

        {error && walletStatus !== 'error' && (
          <section className="card error-card">
            <h2>Error</h2>
            <p className="error">{error}</p>
          </section>
        )}

        <section className="card privacy-card">
          <h2>Privacy Model</h2>
          <div className="privacy-info">
            <div className="privacy-item">
              <span className="badge public">Public</span>
              <span>Agent count, contract state root</span>
            </div>
            <div className="privacy-item">
              <span className="badge private">Private</span>
              <span>Agent capabilities, ownership proofs</span>
            </div>
            <p className="privacy-note">
              Agent capabilities are committed on-chain via ZK proofs. Observers
              can verify an agent exists without seeing what it does.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
