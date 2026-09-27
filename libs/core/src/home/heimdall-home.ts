import os from 'node:os';
import path from 'node:path';

export const HEIMDALL_HOME_DIRNAME = '.heimdall';

// macOS only for now: no XDG or Windows locations.
export function heimdallHomeDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, HEIMDALL_HOME_DIRNAME);
}
