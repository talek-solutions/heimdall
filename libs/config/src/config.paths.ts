import os from 'node:os';
import path from 'node:path';
import { HEIMDALL_HOME_DIRNAME, heimdallHomeDir } from '@heimdall/core';
import { ConfigEnvVariable } from './enums';

export { HEIMDALL_HOME_DIRNAME };
export const CONFIG_FILENAME = 'config.yaml';

export function defaultConfigPath(homeDir: string = os.homedir()): string {
  return path.join(heimdallHomeDir(homeDir), CONFIG_FILENAME);
}

export function resolveConfigPath(env: NodeJS.ProcessEnv, homeDir: string = os.homedir()): string {
  const fromEnv = env[ConfigEnvVariable.ConfigPath];

  return fromEnv !== undefined && fromEnv !== ''
    ? path.resolve(fromEnv)
    : defaultConfigPath(homeDir);
}
