import { useState, useCallback, useEffect } from 'react';
import './App.css';
import { CONTRACTS, type ContractKey } from './compiledContract';
import type { AuctionView } from './auctionView';

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

  const [auctionId, setAuctionId] = useState('');
  const [bidderId, setBidderId] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [auctionBusy, setAuctionBusy] = useState<
    null | 'create' | 'bid' | 'close' | 'reveal' | 'finalize' | 'read'
  >(null);
  const [auctionView, setAuctionView] = useState<AuctionView | null>(null);
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

  const refreshAuction = useCallback(async () => {
    const contractAddress = deployed['auction'];
    if (!config || !contractAddress || !auctionId) return null;
    const { createSession } = await import('./wallet');
    const { readAuctionView } = await import('./auctionView');
    const session = createSession(config, 'auction');
    const view = await readAuctionView(session.publicDataProvider, contractAddress, auctionId);
    setAuctionView(view);
    return view;
  }, [config, deployed, auctionId]);

  /**
   * Sealed-bid procurement auction. The amount, blinding nonce, owner secret,
   * and bidder secret stay in this browser. The chain stores commitments plus,
   * once a bid is the lowest reveal, that winning amount and pseudonym.
   */
  const handleAuction = useCallback(
    async (action: 'create' | 'bid' | 'close' | 'reveal' | 'finalize') => {
      const contractAddress = deployed['auction'];
      if (!config || !walletApi || !contractAddress || !auctionId) return;
      if ((action === 'bid' || action === 'reveal') && !bidderId) return;
      if (action === 'bid' && !bidAmount) return;
      setAuctionBusy(action);
      setError(null);

      try {
        const { createSession } = await import('./wallet');
        const { getCompiledContract } = await import('./compiledContract');
        const { callCircuit } = await import('./contracts');
        const {
          toFixedBytes,
          saveAuctionOwner,
          activateOwner,
          saveSealedBid,
          activateBid,
          parseBidAmount,
        } = await import('./privateState');

        const session = createSession(config, 'auction');
        const compiled = await getCompiledContract('auction');
        const idBytes = toFixedBytes(auctionId);

        let txId: string;
        let message: string;

        if (action === 'create') {
          saveAuctionOwner(auctionId);
          ({ txId } = await callCircuit(
            session, walletApi, compiled, contractAddress,
            'createAuction', [idBytes],
          ));
          message =
            `Auction "${auctionId}" opened. The buyer key is stored only in this browser — ` +
            `only that key can close bidding and finalize.`;
        } else if (action === 'bid') {
          const amount = parseBidAmount(bidAmount);
          saveSealedBid(auctionId, bidderId, amount);
          ({ txId } = await callCircuit(
            session, walletApi, compiled, contractAddress,
            'commitBid', [idBytes, toFixedBytes(bidderId)],
          ));
          message =
            `Sealed bid committed to "${auctionId}" as "${bidderId}". ` +
            `The amount and nonce stay in this browser until you reveal.`;
        } else if (action === 'close') {
          if (!activateOwner(auctionId)) {
            throw new Error(
              'No buyer key for this auction is stored in this browser. Only the wallet that opened it can close bidding.',
            );
          }
          ({ txId } = await callCircuit(
            session, walletApi, compiled, contractAddress,
            'closeBidding', [idBytes],
          ));
          message = `Bidding closed on "${auctionId}". Bidders can now reveal.`;
        } else if (action === 'reveal') {
          if (!activateBid(auctionId, bidderId)) {
            throw new Error(
              `No sealed bid for "${bidderId}" on "${auctionId}" is stored in this browser, so it cannot be revealed.`,
            );
          }
          ({ txId } = await callCircuit(
            session, walletApi, compiled, contractAddress,
            'revealBid', [idBytes, toFixedBytes(bidderId)],
          ));
          message =
            `Bid revealed on "${auctionId}". If it is the lowest so far, the amount is now public; ` +
            `a higher bid stays off the ledger.`;
        } else {
          if (!activateOwner(auctionId)) {
            throw new Error(
              'No buyer key for this auction is stored in this browser. Only the buyer who opened it can finalize.',
            );
          }
          ({ txId } = await callCircuit(
            session, walletApi, compiled, contractAddress,
            'finalizeAuction', [idBytes],
          ));
          message = `Auction "${auctionId}" finalized. The lowest revealed bid is the winner.`;
        }

        setTxResult(`${message} Tx: ${txId}`);
        try {
          await refreshAuction();
        } catch {
          // The indexer can lag the transaction. The tx id above is still the result.
        }
      } catch (err: any) {
        console.error('Auction error:', err);
        setError(err.message || `Auction ${action} failed`);
      } finally {
        setAuctionBusy(null);
      }
    },
    [config, walletApi, deployed, auctionId, bidderId, bidAmount, refreshAuction],
  );

  const handleReadAuction = useCallback(async () => {
    if (!auctionId) return;
    setAuctionBusy('read');
    setError(null);
    try {
      const view = await refreshAuction();
      if (view && !view.found) {
        setTxResult(`No auction "${auctionId}" on this contract yet.`);
      }
    } catch (err: any) {
      console.error('Auction read error:', err);
      setError(err.message || 'Could not read the auction');
    } finally {
      setAuctionBusy(null);
    }
  }, [auctionId, refreshAuction]);

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
                  href={`https://explorer.${network}.midnight.network/contracts/${deployed[k]}`}
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

        {walletStatus === 'connected' && deployed['auction'] && (
          <section className="card circuit-card">
            <h2>Sealed-Bid Auction</h2>
            <p className="description">
              Procurement auction: the lowest revealed bid wins. Open an auction,
              commit a sealed bid, then close bidding. The amount, blinding nonce,
              and bidder key stay in this browser; the chain records{' '}
              <code>persistentCommit(amount, nonce)</code>. After close, reveal
              your own bid. A bid that is not the lowest stays off the ledger.
              The buyer who opened the auction is the only one who can close it
              and finalize the winner.
            </p>
            <div className="input-group">
              <label htmlFor="auctionId">Auction ID (public)</label>
              <input
                id="auctionId"
                type="text"
                value={auctionId}
                onChange={(e) => {
                  setAuctionId(e.target.value);
                  setAuctionView(null);
                }}
                placeholder="e.g. summarise-q3-report"
              />
              <button
                className="btn primary"
                onClick={() => handleAuction('create')}
                disabled={auctionBusy !== null || !auctionId}
              >
                {auctionBusy === 'create' ? 'Opening…' : 'Open Auction'}
              </button>
            </div>
            <div className="input-group">
              <label htmlFor="bidderId">Bidder ID (public pseudonym)</label>
              <input
                id="bidderId"
                type="text"
                value={bidderId}
                onChange={(e) => setBidderId(e.target.value)}
                placeholder="e.g. provider-7"
              />
              <label htmlFor="bidAmount">Bid amount (private, whole number, lowest wins)</label>
              <input
                id="bidAmount"
                type="text"
                inputMode="numeric"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                placeholder="e.g. 120"
              />
              <button
                className="btn primary"
                onClick={() => handleAuction('bid')}
                disabled={auctionBusy !== null || !auctionId || !bidderId || !bidAmount}
              >
                {auctionBusy === 'bid' ? 'Committing…' : 'Commit Sealed Bid'}
              </button>
              <button
                className="btn primary"
                onClick={() => handleAuction('reveal')}
                disabled={auctionBusy !== null || !auctionId || !bidderId}
              >
                {auctionBusy === 'reveal' ? 'Revealing…' : 'Reveal My Bid'}
              </button>
            </div>
            <div className="input-group">
              <button
                className="btn secondary"
                onClick={() => handleAuction('close')}
                disabled={auctionBusy !== null || !auctionId}
              >
                {auctionBusy === 'close' ? 'Closing…' : 'Close Bidding'}
              </button>
              <button
                className="btn secondary"
                onClick={() => handleAuction('finalize')}
                disabled={auctionBusy !== null || !auctionId}
              >
                {auctionBusy === 'finalize' ? 'Finalizing…' : 'Finalize Winner'}
              </button>
              <button
                className="btn secondary"
                onClick={handleReadAuction}
                disabled={auctionBusy !== null || !auctionId}
              >
                {auctionBusy === 'read' ? 'Reading…' : 'Read Auction'}
              </button>
            </div>
            {auctionView && auctionView.found && (
              <div className="contract-info">
                <p>
                  <span className="label">Phase:</span> {auctionView.phaseLabel}
                </p>
                <p>
                  <span className="label">Committed / revealed:</span>{' '}
                  {auctionView.bidCount.toString()} / {auctionView.revealedCount.toString()}
                </p>
                {auctionView.winnerPseudonym ? (
                  <p className="result">
                    {auctionView.phase === 3n ? 'Winner' : 'Lowest bid so far'}:{' '}
                    {auctionView.winnerPseudonym} at {auctionView.winningAmount?.toString()}
                  </p>
                ) : (
                  <p className="description">No bid revealed yet. Losing amounts are not on the ledger.</p>
                )}
              </div>
            )}
            {auctionView && !auctionView.found && (
              <p className="description">No auction with this id on the deployed contract.</p>
            )}
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
              <span>Agent capabilities, bid nonces, losing bid amounts</span>
            </div>
            <div className="privacy-item">
              <span className="badge public">Public</span>
              <span>Winning bidder and the lowest revealed amount</span>
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
