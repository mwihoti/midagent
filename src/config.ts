export type NetworkConfig = {
  networkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  nodeWS: string;
  proofServer: string;
  faucet: string;
};

export const LOCAL_CONFIG: NetworkConfig = {
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  faucet: '',
};

// Preview is still hosted by Midnight and needs no token. It is a much
// smaller chain than Preprod, so a cold wallet sync there takes minutes
// instead of hours.
export const PREVIEW_CONFIG: NetworkConfig = {
  networkId: 'preview',
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: 'http://127.0.0.1:6300',
  faucet: 'https://faucet.preview.midnight.network/',
};

// Midnight retired indexer.preprod.midnight.network and
// rpc.preprod.midnight.network at 22:00 UTC on 9 October 2026. The indexer
// answers with HTTP 410. Blockfrost now serves Preprod indexer and node RPC,
// and every URL needs a project token.
// https://docs.midnight.network/guides/networks-and-environments
const PREPROD_BLOCKFROST = {
  indexer: 'https://midnight-preprod.blockfrost.io/api/v0',
  indexerWS: 'wss://midnight-preprod.blockfrost.io/api/v0/ws',
  node: 'https://rpc.midnight-preprod.blockfrost.io',
  nodeWS: 'wss://rpc.midnight-preprod.blockfrost.io',
} as const;

export function withBlockfrostProjectId(url: string, projectId: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}project_id=${encodeURIComponent(projectId)}`;
}

/** Strip a Blockfrost token from a URL before logging it. */
export function redactProjectId(value: string): string {
  return value.replace(/([?&]project_id=)[^&\s]*/g, '$1<redacted>');
}

function blockfrostProjectId(): string {
  const projectId = process.env['BLOCKFROST_PROJECT_ID']?.trim();
  if (!projectId) {
    throw new Error(
      'BLOCKFROST_PROJECT_ID is not set. Preprod indexer and RPC are served by Blockfrost; ' +
        'create a Midnight Preprod project at https://blockfrost.io and put the project id in .env ' +
        '(see .env.example). Do not commit the real value.',
    );
  }
  return projectId;
}

// Built at call time so a missing token fails here, with this message, instead
// of as an HTTP 403 deep inside a wallet sync.
export function preprodConfig(): NetworkConfig {
  const projectId = blockfrostProjectId();
  return {
    networkId: 'preprod',
    indexer: withBlockfrostProjectId(PREPROD_BLOCKFROST.indexer, projectId),
    indexerWS: withBlockfrostProjectId(PREPROD_BLOCKFROST.indexerWS, projectId),
    node: withBlockfrostProjectId(PREPROD_BLOCKFROST.node, projectId),
    nodeWS: withBlockfrostProjectId(PREPROD_BLOCKFROST.nodeWS, projectId),
    proofServer: 'http://127.0.0.1:6300',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  };
}

export function getConfig(): NetworkConfig {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'preprod';
  if (network === 'preprod') {
    return preprodConfig();
  }
  if (network === 'preview') {
    return PREVIEW_CONFIG;
  }
  if (network !== 'local') {
    throw new Error(
      `Unknown network: ${network}. Supported networks are 'local', 'preview', and 'preprod'.`,
    );
  }
  return LOCAL_CONFIG;
}
