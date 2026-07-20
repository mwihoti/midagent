import '@midnight-ntwrk/dapp-connector-api';

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

  return {
    api,
    config,
    unshieldedAddress: unshieldedResult.unshieldedAddress,
    shieldedAddress: shieldedResult.shieldedAddress,
  };
}
