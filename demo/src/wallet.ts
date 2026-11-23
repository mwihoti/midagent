import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

// Wallet discovery lives in ./walletDiscovery (no SDK imports), and the
// connect() call itself happens synchronously inside the click handler in
// App.tsx: Lace opens its approval popup only while the click's user
// activation is still live, so nothing may be awaited before connect().
// This finishes the session once the wallet has approved the connection.
export async function finishConnect(api: any): Promise<{
  config: any;
  unshieldedAddress: string;
  shieldedAddress: string;
}> {
  const [config, unshieldedResult, shieldedResult] = await Promise.all([
    api.getConfiguration(),
    api.getUnshieldedAddress(),
    api.getShieldedAddresses(),
  ]);

  setNetworkId(config.networkId);

  return {
    config,
    unshieldedAddress: unshieldedResult.unshieldedAddress,
    shieldedAddress: shieldedResult.shieldedAddress,
  };
}

export function createSession(config: any, contractKey: string = 'agent-registry') {
  setNetworkId(config.networkId);

  // BASE_URL is '/' locally and on root-domain hosts, '/midagent/' on GitHub
  // Pages — the ZK proving assets are fetched relative to wherever the app is
  // served from, so a sub-path deployment still finds them.
  const zkConfigProvider = new FetchZkConfigProvider(
    new URL(
      `${import.meta.env.BASE_URL}contract/${contractKey}`,
      window.location.origin,
    ).toString(),
    window.fetch.bind(window),
  );

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
  );

  return { config, zkConfigProvider, publicDataProvider };
}
