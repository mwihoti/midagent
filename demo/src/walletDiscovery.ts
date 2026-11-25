// Wallet discovery with no Midnight SDK imports, so it runs the moment the page
// loads instead of waiting for the large SDK/WASM chunk (which used to gate it).
//
// DApp Connector API v4: each wallet injects an "Initial API" object under
// window.midnight. Current Lace builds use a fresh random key on every page
// load (not `mnLace`) and identify themselves by `rdns`; 1AM uses the fixed key
// '1am'. So we scan every entry and label wallets by rdns, then name.

/** Connector API major version this DApp is written against. */
export const SUPPORTED_API_MAJOR = 4;

export interface DiscoveredWallet {
  /** Key under window.midnight. Lace changes it on every page load. */
  key: string;
  /** Display name. Rendered as React text, never as HTML. */
  label: string;
  rdns?: string;
  apiVersion?: string;
  /** True when it implements connector API v4 and has connect(). */
  supported: boolean;
  /** Why an unsupported wallet can't be used. */
  reason?: string;
  api: any;
}

const RDNS_LABELS: Record<string, string> = {
  'io.lace.wallet': 'Lace',
  'com.midnight.1am': '1AM',
};

const KEY_LABELS: Record<string, string> = {
  mnLace: 'Lace',
  lace: 'Lace',
  '1am': '1AM',
  oneam: '1AM',
};

function labelFor(key: string, api: any): string {
  const rdns = typeof api.rdns === 'string' ? api.rdns : '';
  if (RDNS_LABELS[rdns]) return RDNS_LABELS[rdns];
  if (typeof api.name === 'string' && api.name.trim()) return api.name.trim().slice(0, 40);
  return KEY_LABELS[key] ?? 'Unknown wallet';
}

export function discoverWallets(): DiscoveredWallet[] {
  let injected: unknown;
  try {
    injected = (window as any).midnight;
  } catch {
    return [];
  }
  if (!injected || typeof injected !== 'object') return [];

  const found: DiscoveredWallet[] = [];
  let entries: [string, any][];
  try {
    entries = Object.entries(injected as Record<string, any>);
  } catch {
    return [];
  }
  for (const [key, api] of entries) {
    // A half-initialised or proxied injection can throw on property reads;
    // skip it rather than break discovery (and the Connect button) entirely.
    try {
      const w = inspect(key, api);
      if (w) found.push(w);
    } catch {
      continue;
    }
  }
  // If two wallets share a label (e.g. two Lace profiles), make them distinct.
  const seen = new Map<string, number>();
  for (const w of found) {
    const n = (seen.get(w.label) ?? 0) + 1;
    seen.set(w.label, n);
    if (n > 1) w.label = `${w.label} (${n})`;
  }
  return found;
}

function inspect(key: string, api: any): DiscoveredWallet | null {
  if (!api || typeof api !== 'object') return null;
  const apiVersion = typeof api.apiVersion === 'string' ? api.apiVersion : undefined;
  const major = apiVersion ? Number(apiVersion.split('.')[0]) : NaN;
  const hasConnect = typeof api.connect === 'function';

  let reason: string | undefined;
  if (!hasConnect) {
    reason =
      typeof api.enable === 'function'
        ? 'uses the old connector API (enable). Update the extension.'
        : 'has no connect() method.';
  } else if (major !== SUPPORTED_API_MAJOR) {
    reason = `implements connector API ${apiVersion ?? 'unknown'}; this demo needs ${SUPPORTED_API_MAJOR}.x.`;
  }

  return {
    key,
    label: labelFor(key, api),
    rdns: typeof api.rdns === 'string' ? api.rdns : undefined,
    apiVersion,
    supported: !reason,
    reason,
    api,
  };
}

/** Explains, in one sentence, why no wallet can be connected. */
export function noWalletMessage(all: DiscoveredWallet[]): string {
  const unsupported = all.filter((w) => !w.supported);
  if (unsupported.length > 0) {
    return unsupported.map((w) => `${w.label} ${w.reason}`).join(' ');
  }
  return 'No Midnight wallet detected. Install Lace or 1AM and allow it on this site; it is picked up automatically (reload if it was just installed).';
}

/** Turns a connector error into something a user can act on. */
export function friendlyConnectError(err: any, walletLabel: string, network: string): string {
  const code = err?.type === 'DAppConnectorAPIError' ? err.code : undefined;
  let detail: string = err?.reason || err?.message || err?.code || '';
  if (!detail) {
    try {
      detail = typeof err === 'object' ? JSON.stringify(err) : String(err);
    } catch {
      detail = '';
    }
  }
  detail = detail && detail !== '{}' ? String(detail) : 'unknown error';
  switch (code) {
    case 'Rejected':
    case 'PermissionRejected':
      return `${walletLabel}: connection request was declined.`;
    case 'Disconnected':
      return `${walletLabel} disconnected. Unlock the wallet and try again.`;
    default:
      return (
        `${walletLabel} could not connect to ${network}: ${detail}. ` +
        `Check that ${walletLabel} is unlocked and set to the ${network} network.`
      );
  }
}
