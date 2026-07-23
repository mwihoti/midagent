import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

export interface WalletInfo {
  key: string;
  label: string;
  api: any;
}

// Friendly display names for known injected wallet keys.
const WALLET_LABELS: Record<string, string> = {
  mnLace: 'Lace',
  lace: 'Lace',
  '1am': '1AM',
  oneam: '1AM',
  midnight: 'Midnight',
};

function labelFor(key: string): string {
  return WALLET_LABELS[key] ?? key;
}

// Every Midnight-compatible wallet injects itself under window.midnight.<key>.
// We list all of them (that expose connect()) so the user can pick.
export function listWallets(): WalletInfo[] {
  const injected = (window as any).midnight;
  if (!injected) return [];
  return Object.entries(injected)
    .filter(([, api]) => api && typeof (api as any).connect === 'function')
    .map(([key, api]) => ({ key, label: labelFor(key), api: api as any }));
}

export async function connectWallet(
  network: string = 'preprod',
  walletKey?: string,
): Promise<{
  api: any;
  config: any;
  unshieldedAddress: string;
  shieldedAddress: string;
  walletKey: string;
  walletLabel: string;
}> {
  const wallets = listWallets();
  if (wallets.length === 0) {
    throw new Error('No Midnight wallet found. Install 1AM or Lace extension.');
  }

  const wallet = walletKey
    ? wallets.find((w) => w.key === walletKey)
    : wallets[0];
  if (!wallet) {
    throw new Error(`Wallet "${walletKey}" not found. Available: ${wallets.map((w) => w.label).join(', ')}`);
  }

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
    walletKey: wallet.key,
    walletLabel: wallet.label,
  };
}

export function createSession(config: any, contractKey: string = 'agent-registry') {
  setNetworkId(config.networkId);

  const zkConfigProvider = new FetchZkConfigProvider(
    new URL(`/contract/${contractKey}`, window.location.origin).toString(),
    window.fetch.bind(window),
  );

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
  );

  return { config, zkConfigProvider, publicDataProvider };
}
