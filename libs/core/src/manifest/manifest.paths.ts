import os from 'node:os';
import path from 'node:path';
import { heimdallHomeDir } from '../home/heimdall-home';
import { ManifestEnvVariable } from './enums';

export const MANIFEST_FILENAME = 'manifest.yaml';

export function defaultManifestPath(homeDir: string = os.homedir()): string {
  return path.join(heimdallHomeDir(homeDir), MANIFEST_FILENAME);
}

export function resolveManifestPath(
  env: NodeJS.ProcessEnv,
  homeDir: string = os.homedir(),
): string {
  const fromEnv = env[ManifestEnvVariable.ManifestPath];

  return fromEnv !== undefined && fromEnv !== ''
    ? path.resolve(fromEnv)
    : defaultManifestPath(homeDir);
}
