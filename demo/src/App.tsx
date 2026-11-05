import { useState, useCallback, useEffect } from 'react';
import './App.css';
import { CONTRACTS, type ContractKey } from './compiledContract';
import type { AuctionView } from './auctionView';
import { hasAuctionOwner, hasSealedBid } from './privateState';

const STEPS = [
  { id: 'open', label: 'Open', owner: false },
  { id: 'commit', label: 'Commit', owner: false },
  { id: 'close', label: 'Close', owner: true },
  { id: 'reveal', label: 'Reveal', owner: false },
  { id: 'finalize', label: 'Finalize', owner: true },
] as const;

type StepId = (typeof STEPS)[number]['id'];
type StepStatus = 'complete' | 'current' | 'available' | 'locked';

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Which step the ledger (and a locally stored commit) says is the one to do. */
function stepStatus(id: StepId, view: AuctionView | null, hasCommit: boolean): StepStatus {
  const found = Boolean(view?.found && view.phase != null);
  const phase = found ? view!.phase! : 0n;
  if (phase >= 3n) return 'complete';

  if (id === 'open') return found ? 'complete' : 'current';

  if (id === 'commit') {
    if (!found) return 'locked';
    if (phase >= 2n || hasCommit) return 'complete';
    return 'current';
  }

  if (id === 'close') {
    if (!found) return 'locked';
    if (phase >= 2n) return 'complete';
    return hasCommit ? 'current' : 'available';
  }

  if (id === 'reveal') {
    if (phase < 2n) return 'locked';
    return hasCommit ? 'current' : 'available';
  }

  if (phase < 2n) return 'locked';
  return hasCommit ? 'available' : 'current';
}

function currentStepId(view: AuctionView | null, hasCommit: boolean): StepId | null {
  if (view?.found && view.phase != null && view.phase >= 3n) return null;
  return STEPS.find((step) => stepStatus(step.id, view, hasCommit) === 'current')?.id ?? null;
}

function ContractAddress({
  label,
  value,
  copied,
  onCopy,
  explorerHref,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  explorerHref: string;
}) {
  return (
    <div className="addr-row">
      <span className="label">{label}</span>
      <code title={value}>{shortId(value)}</code>
      <button type="button" className="btn refresh" onClick={onCopy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a className="explorer-link" href={explorerHref} target="_blank" rel="noopener noreferrer">
        Explorer
      </a>
    </div>
  );
}

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
  const [pickedStep, setPickedStep] = useState<StepId | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
    setAuctionView(null);
    setPickedStep(null);
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
        setTxResult(null);
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
      setTxResult(null);
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
      setTxResult(null);
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
        setTxResult(null);
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
      setTxResult(null);
      setError(err.message || 'Could not read the auction');
    } finally {
      setAuctionBusy(null);
    }
  }, [auctionId, refreshAuction]);

  const hasCommit = Boolean(auctionId && bidderId && hasSealedBid(auctionId, bidderId));
  const ownsAuction = Boolean(auctionId && hasAuctionOwner(auctionId));
  const derivedStep = currentStepId(auctionView, hasCommit);
  const activeStep = pickedStep ?? derivedStep;

  useEffect(() => {
    setPickedStep(null);
  }, [auctionId, hasCommit, auctionView?.found, auctionView?.phase]);

  const copyAddress = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
    } catch (err: any) {
      setTxResult(null);
      setError(err?.message || 'Could not copy the address.');
    }
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Midnight AI Agent Marketplace</h1>
        <p className="lede">
          A sealed-bid procurement auction where AI agents bid privately on Midnight.
        </p>
        <p className="support">The lowest revealed bid wins.</p>
      </header>

      <main>
        <section className="card wallet-card">
          <h2>Wallet</h2>
          {walletStatus === 'disconnected' && (
            <div className="input-group">
              <label htmlFor="wallet">Extension</label>
              <select
                id="wallet"
                value={selectedWallet}
                onChange={(e) => setSelectedWallet(e.target.value)}
                disabled={wallets.length === 0}
              >
                {wallets.length === 0 ? (
                  <option value="">No wallet detected</option>
                ) : (
                  wallets.map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))
                )}
              </select>
              <p className="hint">Choose the Midnight extension in this browser.</p>
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
              <p className="hint">Preprod is the network this demo targets.</p>
              <button
                className="btn primary"
                type="button"
                onClick={handleConnect}
                disabled={wallets.length === 0}
              >
                Connect{' '}
                {wallets.find((w) => w.key === selectedWallet)?.label ?? 'wallet'}{' '}
                ({network})
              </button>
              {wallets.length === 0 && (
                <p className="wallet-hint">
                  No wallet detected. Install{' '}
                  <a
                    href="https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Lace
                  </a>{' '}
                  or{' '}
                  <a href="https://1am.xyz/" target="_blank" rel="noopener noreferrer">
                    1AM
                  </a>
                  , then reload this page.
                </p>
              )}
            </div>
          )}
          {walletStatus === 'connecting' && (
            <p className="status">Connecting…</p>
          )}
          {walletStatus === 'connected' && (
            <div className="connected-info">
              <p className="address">
                <span className="label">{connectedWallet ?? 'Wallet'} · {network}</span>
                <span className="value" title={address || ''}>
                  {address ? shortId(address) : ''}
                </span>
              </p>
              <button className="btn secondary" type="button" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          )}
          {walletStatus === 'error' && (
            <div className="error-state">
              <p className="error" role="alert">{error}</p>
              <button className="btn primary" type="button" onClick={handleConnect}>
                Retry
              </button>
            </div>
          )}
        </section>

        {walletStatus === 'connected' && (
          <section className="card" aria-labelledby="auction-heading">
            <h2 id="auction-heading">Sealed-bid auction</h2>
            {!deployed.auction ? (
              <div className="step-panel">
                <p className="hint">
                  Deploy the auction contract on {network}. After that, open a procurement and take bids.
                </p>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => handleDeploy('auction')}
                  disabled={deploying !== null}
                >
                  {deploying === 'auction' ? 'Deploying…' : 'Deploy auction'}
                </button>
              </div>
            ) : (
              <>
                <ContractAddress
                  label="Auction contract"
                  value={deployed.auction}
                  copied={copiedKey === 'auction'}
                  onCopy={() => copyAddress('auction', deployed.auction)}
                  explorerHref={`https://explorer.${network}.midnight.network/contracts/${deployed.auction}`}
                />
                <div className="input-group">
                  <div className="label-row">
                    <label htmlFor="auctionId">Auction id</label>
                    <button
                      className="btn refresh"
                      type="button"
                      onClick={handleReadAuction}
                      disabled={auctionBusy !== null || !auctionId}
                    >
                      {auctionBusy === 'read' ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
                  <input
                    id="auctionId"
                    type="text"
                    value={auctionId}
                    onChange={(e) => {
                      setAuctionId(e.target.value);
                      setAuctionView(null);
                    }}
                    placeholder="summarise-q3-report"
                  />
                  <p className="hint">
                    Public name for this procurement. Refresh to read an id that is already on the contract.
                  </p>
                </div>

                {auctionView?.found && (
                  <p className="meta">
                    {auctionView.phaseLabel}. {auctionView.bidCount.toString()} committed,{' '}
                    {auctionView.revealedCount.toString()} revealed.
                  </p>
                )}
                {auctionView && !auctionView.found && (
                  <p className="hint">No auction with this id on the contract yet.</p>
                )}

                <ol className="stepper">
                  {STEPS.map((step) => {
                    const status = stepStatus(step.id, auctionView, hasCommit);
                    return (
                      <li key={step.id} className={`step ${status}${activeStep === step.id ? ' shown' : ''}`}>
                        <button
                          type="button"
                          disabled={status === 'locked'}
                          aria-current={status === 'current' ? 'step' : undefined}
                          onClick={() => setPickedStep(step.id)}
                        >
                          <span className="step-name">{step.label}</span>
                          {step.owner && <span className="step-meta">Owner</span>}
                          <span className="step-state">
                            {status === 'complete'
                              ? 'Done'
                              : status === 'locked'
                                ? 'Locked'
                                : status === 'current'
                                  ? 'Now'
                                  : 'Ready'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>

                <div className="step-panel">
                  {activeStep === 'open' && (
                    stepStatus('open', auctionView, hasCommit) === 'complete' ? (
                      <p className="hint">This auction is open.</p>
                    ) : (
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => handleAuction('create')}
                        disabled={auctionBusy !== null || !auctionId}
                      >
                        {auctionBusy === 'create' ? 'Opening…' : 'Open auction'}
                      </button>
                    )
                  )}

                  {activeStep === 'commit' && (
                    <div className="input-group">
                      {hasCommit && (
                        <p className="hint">A sealed bid for “{bidderId}” is stored in this browser.</p>
                      )}
                      <label htmlFor="bidderId">Bidder id</label>
                      <input
                        id="bidderId"
                        type="text"
                        value={bidderId}
                        onChange={(e) => setBidderId(e.target.value)}
                        placeholder="provider-7"
                      />
                      <p className="hint">Public pseudonym. It is not the wallet address.</p>
                      <label htmlFor="bidAmount">Bid amount</label>
                      <input
                        id="bidAmount"
                        type="text"
                        inputMode="numeric"
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        placeholder="120"
                      />
                      <p className="hint">
                        Whole number of tokens. The lowest revealed bid wins. The amount stays in this browser until you reveal it.
                      </p>
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => handleAuction('bid')}
                        disabled={auctionBusy !== null || !auctionId || !bidderId || !bidAmount}
                      >
                        {auctionBusy === 'bid' ? 'Committing…' : 'Commit sealed bid'}
                      </button>
                    </div>
                  )}

                  {activeStep === 'close' && (
                    <>
                      <p className="owner-tag">Owner</p>
                      <p className="hint">Only the browser that opened this auction can close bidding.</p>
                      {stepStatus('close', auctionView, hasCommit) === 'complete' ? (
                        <p className="hint">Bidding is closed.</p>
                      ) : (
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => handleAuction('close')}
                          disabled={auctionBusy !== null || !auctionId || !ownsAuction}
                        >
                          {auctionBusy === 'close' ? 'Closing…' : 'Close bidding'}
                        </button>
                      )}
                      {!ownsAuction && stepStatus('close', auctionView, hasCommit) !== 'complete' && (
                        <p className="hint">This browser does not hold the buyer key for this auction.</p>
                      )}
                    </>
                  )}

                  {activeStep === 'reveal' && (
                    <div className="input-group">
                      <label htmlFor="revealBidderId">Bidder id</label>
                      <input
                        id="revealBidderId"
                        type="text"
                        value={bidderId}
                        onChange={(e) => setBidderId(e.target.value)}
                        placeholder="provider-7"
                      />
                      <p className="hint">
                        Reveal uses the amount and nonce stored in this browser for this pseudonym. A bid that is not the lowest stays off the ledger.
                      </p>
                      {stepStatus('reveal', auctionView, hasCommit) === 'complete' ? (
                        <p className="hint">This auction is already finalized.</p>
                      ) : (
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => handleAuction('reveal')}
                          disabled={auctionBusy !== null || !auctionId || !bidderId || !hasCommit}
                        >
                          {auctionBusy === 'reveal' ? 'Revealing…' : 'Reveal bid'}
                        </button>
                      )}
                      {!hasCommit && (
                        <p className="hint">No sealed bid for this pseudonym is stored in this browser.</p>
                      )}
                    </div>
                  )}

                  {activeStep === 'finalize' && (
                    <>
                      <p className="owner-tag">Owner</p>
                      <p className="hint">
                        Only the buyer who opened the auction can finalize. The lowest revealed bid becomes the winner.
                      </p>
                      {stepStatus('finalize', auctionView, hasCommit) === 'complete' ? (
                        <p className="hint">The winner is finalized.</p>
                      ) : (
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => handleAuction('finalize')}
                          disabled={auctionBusy !== null || !auctionId || !ownsAuction}
                        >
                          {auctionBusy === 'finalize' ? 'Finalizing…' : 'Finalize winner'}
                        </button>
                      )}
                      {!ownsAuction && stepStatus('finalize', auctionView, hasCommit) !== 'complete' && (
                        <p className="hint">This browser does not hold the buyer key for this auction.</p>
                      )}
                    </>
                  )}
                </div>

                {auctionView?.winnerPseudonym && (
                  <div className="result-panel" role="status">
                    <p className="kicker">{auctionView.phase === 3n ? 'Winner' : 'Lowest bid so far'}</p>
                    <p className="who">{auctionView.winnerPseudonym}</p>
                    <p className="amount">{auctionView.winningAmount?.toString()}</p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {walletStatus === 'connected' && (
          <details className="card registry">
            <summary>Agent registry</summary>
            <div className="registry-body">
              {!deployed['agent-registry'] ? (
                <>
                  <p className="hint">Deploy the registry to record what an agent can do without publishing the secret.</p>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => handleDeploy('agent-registry')}
                    disabled={deploying !== null}
                  >
                    {deploying === 'agent-registry' ? 'Deploying…' : 'Deploy registry'}
                  </button>
                </>
              ) : (
                <>
                  <ContractAddress
                    label="Registry contract"
                    value={deployed['agent-registry']}
                    copied={copiedKey === 'agent-registry'}
                    onCopy={() => copyAddress('agent-registry', deployed['agent-registry'])}
                    explorerHref={`https://explorer.${network}.midnight.network/contracts/${deployed['agent-registry']}`}
                  />
                  <h3>Register</h3>
                  <div className="input-group">
                    <label htmlFor="agentId">Agent id</label>
                    <input
                      id="agentId"
                      type="text"
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      placeholder="my-data-analyzer"
                    />
                    <p className="hint">Public identifier. It is stored on the contract.</p>
                    <label htmlFor="capabilities">Capabilities</label>
                    <input
                      id="capabilities"
                      type="text"
                      value={capabilities}
                      onChange={(e) => setCapabilities(e.target.value)}
                      placeholder="sentiment-analysis, summarisation"
                    />
                    <p className="hint">Private. Only a hash of this text is written on-chain.</p>
                    <button
                      className="btn primary"
                      type="button"
                      onClick={handleRegisterAgent}
                      disabled={callingCircuit || proving || !agentId || !capabilities}
                    >
                      {callingCircuit ? 'Proving and submitting…' : 'Register agent'}
                    </button>
                  </div>
                  <h3>Prove capability</h3>
                  <p className="hint">
                    Re-derive the commitment from the capabilities stored in this browser. The contract checks the match and never sees the text.
                  </p>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={handleProveOwnership}
                    disabled={proving || callingCircuit || !agentId}
                  >
                    {proving ? 'Proving…' : 'Prove capability'}
                  </button>
                </>
              )}
            </div>
          </details>
        )}

        {walletStatus === 'connected' && (
          <details className="card">
            <summary>Other contracts</summary>
            <div className="registry-body">
              <p className="hint">Marketplace, payments, and composition deploy the same way. Each one gets its own address.</p>
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
                      {deployed[k] ? ' (deployed)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="btn primary"
                  type="button"
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
              {(Object.keys(deployed) as ContractKey[])
                .filter((k) => k !== 'auction' && k !== 'agent-registry')
                .map((k) => (
                  <ContractAddress
                    key={k}
                    label={CONTRACTS[k].label}
                    value={deployed[k]}
                    copied={copiedKey === k}
                    onCopy={() => copyAddress(k, deployed[k])}
                    explorerHref={`https://explorer.${network}.midnight.network/contracts/${deployed[k]}`}
                  />
                ))}
            </div>
          </details>
        )}

        {txResult && (
          <p className="tx-note" role="status">{txResult}</p>
        )}

        {error && walletStatus !== 'error' && (
          <section className="card error-card">
            <h2>Error</h2>
            <p className="error" role="alert">{error}</p>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <p>Bid amounts stay private until reveal, and agent secrets stay in this browser.</p>
      </footer>
    </div>
  );
}

export default App;
