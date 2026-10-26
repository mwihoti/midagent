/**
 * Preprod endpoint config. Midnight retired the hosted Preprod indexer and RPC
 * on 9 Oct 2026; the CLI must target Blockfrost and keep the project token
 * out of source control.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, redactProjectId, withBlockfrostProjectId } from '../config.js';

const ENV_KEYS = ['MIDNIGHT_NETWORK', 'BLOCKFROST_PROJECT_ID'] as const;
const previous: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  MIDNIGHT_NETWORK: process.env.MIDNIGHT_NETWORK,
  BLOCKFROST_PROJECT_ID: process.env.BLOCKFROST_PROJECT_ID,
};

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('network config', () => {
  it('builds the documented Blockfrost Preprod endpoints from the env token', () => {
    process.env.MIDNIGHT_NETWORK = 'preprod';
    process.env.BLOCKFROST_PROJECT_ID = 'nightpreprod_example_token';

    const config = getConfig();

    expect(config.networkId).toBe('preprod');
    expect(config.node).toBe(
      'https://rpc.midnight-preprod.blockfrost.io?project_id=nightpreprod_example_token',
    );
    expect(config.nodeWS).toBe(
      'wss://rpc.midnight-preprod.blockfrost.io?project_id=nightpreprod_example_token',
    );
    expect(config.indexer).toBe(
      'https://midnight-preprod.blockfrost.io/api/v0?project_id=nightpreprod_example_token',
    );
    expect(config.indexerWS).toBe(
      'wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=nightpreprod_example_token',
    );
    expect(config.proofServer).toBe('http://127.0.0.1:6300');
    expect(config.faucet).toBe('https://midnight-tmnight-preprod.nethermind.dev/');
    expect(config.indexer).not.toContain('indexer.preprod.midnight.network');
    expect(config.node).not.toContain('rpc.preprod.midnight.network');
  });

  it('refuses Preprod when the Blockfrost token is missing', () => {
    process.env.MIDNIGHT_NETWORK = 'preprod';
    delete process.env.BLOCKFROST_PROJECT_ID;
    expect(() => getConfig()).toThrow(/BLOCKFROST_PROJECT_ID/);
  });

  it('leaves Preview on the Midnight-hosted endpoints with no token', () => {
    process.env.MIDNIGHT_NETWORK = 'preview';
    delete process.env.BLOCKFROST_PROJECT_ID;
    const config = getConfig();
    expect(config.indexer).toBe('https://indexer.preview.midnight.network/api/v4/graphql');
    expect(config.node).toBe('https://rpc.preview.midnight.network');
    expect(config.indexer).not.toContain('project_id');
  });

  it('encodes the token and redacts it for logs', () => {
    const url = withBlockfrostProjectId(
      'https://midnight-preprod.blockfrost.io/api/v0',
      'nightpreprod_a/b',
    );
    expect(url).toBe(
      'https://midnight-preprod.blockfrost.io/api/v0?project_id=nightpreprod_a%2Fb',
    );
    expect(redactProjectId(url)).toBe(
      'https://midnight-preprod.blockfrost.io/api/v0?project_id=<redacted>',
    );
  });
});
