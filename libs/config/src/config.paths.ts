import os from 'node:os';
import path from 'node:path';
import { ConfigEnvVariable } from './enums';

export const HEIMDALL_HOME_DIRNAME = '.heimdall';
export const CONFIG_FILENAME = 'config.yaml';

// macOS only for now: no XDG or Windows locations.
export function defaultConfigPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, HEIMDALL_HOME_DIRNAME, CONFIG_FILENAME);
}

export function resolveConfigPath(env: NodeJS.ProcessEnv, homeDir: string = os.homedir()): string {
  const fromEnv = env[ConfigEnvVariable.ConfigPath];

  return fromEnv !== undefined && fromEnv !== ''
    ? path.resolve(fromEnv)
    : defaultConfigPath(homeDir);
}
