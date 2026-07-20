import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

export interface WalletInfo {
  name: string;
  api: any;
}

export function listWallets(): WalletInfo[] {
  const injected = (window as any).midnight;
  if (!injected) return [];
  return Object.entries(injected).map(([key, api]) => ({
    name: key,
    api: api as any,
  }));
}

export async function connectWallet(network: string = 'preprod'): Promise<{
  api: any;
  config: any;
  unshieldedAddress: string;
  shieldedAddress: string;
}> {
  const wallets = listWallets();
  if (wallets.length === 0) {
    throw new Error('No Midnight wallet found. Install 1AM or Lace extension.');
  }

  const wallet = wallets[0];
  const api = await wallet.api.connect(network);

  const [config, unshieldedResult, shieldedResult] = await Promise.all([
    api.getConfiguration(),
    api.getUnshieldedAddress(),
    api.getShieldedAddresses(),
  ]);

  setNetworkId(config.networkId);

  return {
    api,
    config,
    unshieldedAddress: unshieldedResult.unshieldedAddress,
    shieldedAddress: shieldedResult.shieldedAddress,
  };
}

export function createSession(config: any) {
  setNetworkId(config.networkId);

  const zkConfigProvider = new FetchZkConfigProvider(
    new URL('/contract/agent-registry', window.location.origin).toString(),
    window.fetch.bind(window),
  );

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
  );

  return { config, zkConfigProvider, publicDataProvider };
}
