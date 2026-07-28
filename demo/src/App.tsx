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
  const [capabilities, setCapabilities] = useState('');
  const [callingCircuit, setCallingCircuit] = useState(false);
  const [proving, setProving] = useState(false);
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

      const { setSecretFromText, toFixedBytes } = await import('./privateState');

      // The capabilities are the SECRET. Save them to local private state before
      // registering: the circuit reads them as a witness and publishes only
      // persistentHash(capabilities), and proveOwnership later needs the exact
      // same bytes to re-derive that commitment. They never leave this browser.
      setSecretFromText('agentCapabilities', capabilities);

      const session = createSession(config, 'agent-registry');
      const compiled = await getCompiledContract('agent-registry');

      // callCircuit builds the unproven tx, proves it (ZK), balances the dust
      // fee, and submits — returning the on-chain transaction id.
      const { txId } = await callCircuit(
        session,
        walletApi,
        compiled,
        contractAddress,
        'registerAgent',
        [toFixedBytes(agentId)],
      );

      setTxResult(
        `Agent "${agentId}" registered — capabilities committed on-chain, never revealed. Tx: ${txId}`,
      );
    } catch (err: any) {
      console.error('Call error:', err);
      setError(err.message || 'Circuit call failed');
    } finally {
      setCallingCircuit(false);
    }
  }, [config, walletApi, deployed, agentId, capabilities]);

  /**
   * Prove ownership of a registered agent. This is the privacy payoff: the
   * circuit re-derives persistentHash(capabilities) from the locally-stored
   * secret and asserts it equals the commitment already on-chain. Succeeding
   * proves we hold the right capabilities — without transmitting them.
   */
  const handleProveOwnership = useCallback(async () => {
    const contractAddress = deployed['agent-registry'];
    if (!config || !walletApi || !contractAddress || !agentId) return;
    setProving(true);
    setError(null);

    try {
      const { createSession } = await import('./wallet');
      const { getCompiledContract } = await import('./compiledContract');
      const { callCircuit } = await import('./contracts');
      const { toFixedBytes, hasSecret } = await import('./privateState');

      if (!hasSecret('agentCapabilities')) {
        throw new Error(
          'No capabilities stored locally — register an agent from this browser first.',
        );
      }

      const session = createSession(config, 'agent-registry');
      const compiled = await getCompiledContract('agent-registry');

      const { txId } = await callCircuit(
        session,
        walletApi,
        compiled,
        contractAddress,
        'proveOwnership',
        [toFixedBytes(agentId)],
      );

      setTxResult(
        `Ownership of "${agentId}" proven without disclosing the capabilities. Tx: ${txId}`,
      );
    } catch (err: any) {
      console.error('Prove error:', err);
      setError(err.message || 'Ownership proof failed');
    } finally {
      setProving(false);
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
              The agent id is public. The capabilities are private — they stay in
              this browser, and only <code>persistentHash(capabilities)</code> is
              written on-chain.
            </p>
            <div className="input-group">
              <label htmlFor="agentId">Agent ID (public)</label>
              <input
                id="agentId"
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="e.g. my-data-analyzer"
              />
              <label htmlFor="capabilities">Capabilities (private)</label>
              <input
                id="capabilities"
                type="text"
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
                placeholder="e.g. sentiment-analysis,summarisation"
              />
            </div>
            <button
              className="btn primary"
              onClick={handleRegisterAgent}
              disabled={callingCircuit || proving || !agentId || !capabilities}
            >
              {callingCircuit ? 'Proving & Submitting…' : 'Register Agent'}
            </button>
          </section>
        )}

        {walletStatus === 'connected' && deployed['agent-registry'] && (
          <section className="card circuit-card">
            <h2>Prove Ownership</h2>
            <p className="description">
              Prove you own the agent above by re-deriving its commitment from the
              capabilities held locally. The chain verifies the match without ever
              seeing the capabilities — selective disclosure in one click.
            </p>
            <button
              className="btn primary"
              onClick={handleProveOwnership}
              disabled={proving || callingCircuit || !agentId}
            >
              {proving ? 'Proving…' : 'Prove Ownership'}
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
