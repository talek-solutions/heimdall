import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** The code a run or a scorecard came from (ADR 0019, ADR 0022). */
export interface IBuildIdentity {
  readonly version: string;
  /** The full hash of the checkout's HEAD; `null` when the code is not in a git checkout. */
  readonly commit: string | null;
  /** The checkout had uncommitted changes to tracked files. */
  readonly dirty: boolean;
}

/** Resolves to `IBuildIdentity`. */
export const BUILD_IDENTITY = Symbol('BUILD_IDENTITY');

const GIT = 'git';
const GIT_TIMEOUT_MS = 2_000;
const DEPENDENCIES_DIRNAME = 'node_modules';

/**
 * Asks git about the checkout that holds `directory`: the directory of the running entry file,
 * never the working directory, which is wherever the command was started (ADR 0022). Never
 * throws: without git or a checkout the commit is `null`.
 */
export function resolveBuildIdentity(version: string, directory: string): IBuildIdentity {
  const unknown: IBuildIdentity = { version, commit: null, dirty: false };

  try {
    const checkout = git(directory, ['rev-parse', '--show-toplevel']);

    // Installed as a dependency: the enclosing checkout is somebody else's project.
    if (path.relative(checkout, directory).split(path.sep).includes(DEPENDENCIES_DIRNAME)) {
      return unknown;
    }
    return {
      version,
      commit: git(directory, ['rev-parse', 'HEAD']),
      dirty: git(directory, ['status', '--porcelain', '--untracked-files=no']) !== '',
    };
  } catch {
    return unknown;
  }
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync(GIT, ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  }).trim();
}
