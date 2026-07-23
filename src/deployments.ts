import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DeploymentAddresses = {
  networkId: string;
  deployedAt: string;
  contracts: Record<string, string>;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOYMENTS_DIR = path.join(ROOT, 'deployments');

export function deploymentFilePath(networkId: string): string {
  return path.join(DEPLOYMENTS_DIR, `${networkId}.json`);
}

export function loadDeployments(networkId: string): DeploymentAddresses | null {
  const file = deploymentFilePath(networkId);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DeploymentAddresses;
}

export function saveDeployments(
  networkId: string,
  contracts: Record<string, string>,
): string {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });

  const existing = loadDeployments(networkId);
  const merged: DeploymentAddresses = {
    networkId,
    deployedAt: new Date().toISOString(),
    contracts: {
      ...(existing?.contracts ?? {}),
      ...contracts,
    },
  };

  const file = deploymentFilePath(networkId);
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return file;
}
