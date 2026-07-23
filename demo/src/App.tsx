import { useState, useCallback, useEffect } from 'react';
import './App.css';
import { CONTRACTS, type ContractKey } from './compiledContract';

interface WalletChoice {
  key: string;
  label: string;
}

type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

const NETWORKS = ['preview', 'preprod'] as const;
type Network = (typeof NETWORKS)[number];

function App() {
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('disconnected');
  const [address, setAddress] = useState<string | null>(null);
  const [walletApi, setWalletApi] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [network, setNetwork] = useState<Network>('preprod');
  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState<ContractKey>('agent-registry');

  // Wallet extensions inject themselves into window.midnight asynchronously, so
  // poll briefly to discover every available wallet (1AM, Lace, …).
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const detect = async () => {
      const { listWallets } = await import('./wallet');
      const found = listWallets().map((w) => ({ key: w.key, label: w.label }));
      if (cancelled) return;
      setWallets(found);
      setSelectedWallet((cur) => cur || found[0]?.key || '');
      if (found.length === 0 && tries++ < 12) setTimeout(detect, 500);
    };
    detect();
    return () => {
      cancelled = true;
    };
  }, []);
  const [deployed, setDeployed] = useState<Record<string, string>>({});
  const [deploying, setDeploying] = useState<ContractKey | null>(null);
  const [agentId, setAgentId] = useState('');
  const [callingCircuit, setCallingCircuit] = useState(false);
  const [txResult, setTxResult] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setWalletStatus('connecting');
    setError(null);

    try {
      const { connectWallet } = await import('./wallet');

      const { api, config: cfg, unshieldedAddress, walletLabel } =
        await connectWallet(network, selectedWallet || undefined);

      setWalletApi(api);
      setConfig(cfg);
      setAddress(unshieldedAddress);
      setConnectedWallet(walletLabel);
      setWalletStatus('connected');
    } catch (err: any) {
      console.error('Connect error:', err);
      setError(err.message || 'Failed to connect');
      setWalletStatus('error');
    }
  }, [network, selectedWallet]);

  const handleDisconnect = useCallback(() => {
    setWalletApi(null);
    setConfig(null);
    setAddress(null);
    setConnectedWallet(null);
    setDeployed({});
    setTxResult(null);
    setWalletStatus('disconnected');
    setError(null);
  }, []);

  const handleDeploy = useCallback(
    async (key: ContractKey) => {
      if (!config || !walletApi) return;
      setDeploying(key);
      setError(null);

      try {
        const { createSession } = await import('./wallet');
        const { getCompiledContract } = await import('./compiledContract');
        const { deployContract } = await import('./contracts');

        // Each contract has its own ZK assets, so build a session scoped to it.
        const session = createSession(config, key);
        const compiled = await getCompiledContract(key);
        const result = await deployContract(session, walletApi, compiled);

        setDeployed((prev) => ({ ...prev, [key]: result.contractAddress }));
        setTxResult(`${CONTRACTS[key].label} deployed at ${result.contractAddress}`);
      } catch (err: any) {
        console.error('Deploy error:', err);
        setError(`${CONTRACTS[key].label}: ${err.message || 'Deploy failed'}`);
      } finally {
        setDeploying(null);
      }
    },
    [config, walletApi],
  );

  const handleRegisterAgent = useCallback(async () => {
    const contractAddress = deployed['agent-registry'];
    if (!config || !walletApi || !contractAddress || !agentId) return;
    setCallingCircuit(true);
    setError(null);

    try {
      const { createSession } = await import('./wallet');
      const { getCompiledContract } = await import('./compiledContract');
      const { callCircuit } = await import('./contracts');

      const session = createSession(config, 'agent-registry');
      const compiled = await getCompiledContract('agent-registry');

      // Derive a 32-byte agent id from the text input. The agent's actual
      // capabilities are supplied as a ZK *witness* (see compiledContract.ts) —
      // they are proven to match the on-chain commitment without ever being sent
      // to the chain. That is the observable privacy behavior.
      const agentIdBytes = new Uint8Array(32);
      const idBytes = new TextEncoder().encode(agentId.padEnd(32, '\0'));
      agentIdBytes.set(idBytes.slice(0, 32));

      // callCircuit builds the unproven tx, proves it (ZK), balances the dust
      // fee, and submits — returning the on-chain transaction id.
      const { txId } = await callCircuit(
        session,
        walletApi,
        compiled,
        contractAddress,
        'registerAgent',
        [agentIdBytes],
      );

      setTxResult(
        `Agent "${agentId}" registered — capabilities proven, never revealed. Tx: ${txId}`,
      );
    } catch (err: any) {
      console.error('Call error:', err);
      setError(err.message || 'Circuit call failed');
    } finally {
      setCallingCircuit(false);
    }
  }, [config, walletApi, deployed, agentId]);

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
            <div className="input-group">
              <label htmlFor="wallet">Wallet</label>
              <select
                id="wallet"
                value={selectedWallet}
                onChange={(e) => setSelectedWallet(e.target.value)}
                disabled={wallets.length === 0}
              >
                {wallets.length === 0 ? (
                  <option value="">No wallet detected — install 1AM or Lace</option>
                ) : (
                  wallets.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))
                )}
              </select>
              <label htmlFor="network">Network</label>
              <select
                id="network"
                value={network}
                onChange={(e) => setNetwork(e.target.value as Network)}
              >
                {NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                className="btn primary"
                onClick={handleConnect}
                disabled={wallets.length === 0}
              >
                Connect{' '}
                {wallets.find((w) => w.key === selectedWallet)?.label ?? 'Wallet'}{' '}
                ({network})
              </button>
            </div>
          )}
          {walletStatus === 'connecting' && (
            <p className="status">Connecting...</p>
          )}
          {walletStatus === 'connected' && (
            <div className="connected-info">
              <p className="address">
                <span className="label">{connectedWallet ?? 'Wallet'} · {network}</span>
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
            <h2>Deploy Contracts</h2>
            <p className="description">
              Deploy the marketplace contracts to Midnight {network}. Each
              contract deploys independently and gets its own on-chain address.
            </p>
            <div className="input-group">
              <label htmlFor="contract">Contract</label>
              <select
                id="contract"
                value={selectedContract}
                onChange={(e) => setSelectedContract(e.target.value as ContractKey)}
              >
                {(Object.keys(CONTRACTS) as ContractKey[]).map((k) => (
                  <option key={k} value={k}>
                    {CONTRACTS[k].label}
                    {deployed[k] ? ' ✓' : ''}
                  </option>
                ))}
              </select>
              <button
                className="btn primary"
                onClick={() => handleDeploy(selectedContract)}
                disabled={deploying !== null || !!deployed[selectedContract]}
              >
                {deploying === selectedContract
                  ? 'Deploying…'
                  : deployed[selectedContract]
                    ? 'Deployed'
                    : `Deploy ${CONTRACTS[selectedContract].label}`}
              </button>
            </div>

            {(Object.keys(deployed) as ContractKey[]).map((k) => (
              <div className="contract-info" key={k}>
                <p>
                  <span className="label">{CONTRACTS[k].label}:</span>
                </p>
                <p className="contract-address" title={deployed[k]}>
                  {deployed[k]}
                </p>
                <a
                  href={`https://explorer.${network}.midnight.network/contract/${deployed[k]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="explorer-link"
                >
                  View on Explorer
                </a>
              </div>
            ))}
          </section>
        )}

        {walletStatus === 'connected' && deployed['agent-registry'] && (
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
