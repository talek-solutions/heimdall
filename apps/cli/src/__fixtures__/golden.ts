import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Golden files: deterministic output pinned as plain text, reviewed as a diff. Not the golden
 * evaluations of `libs/evals/golden`, which run a real model on demand.
 */
export enum GoldenEnvVariable {
  /** `1` rewrites golden files instead of comparing: `npm run golden:update`. */
  Update = 'HEIMDALL_UPDATE_GOLDEN',
}

/** The repository root, from wherever the spec runs: specs run from `dist`, golden files live in `src`. */
export function repoRoot(): string {
  const marker = join('apps', 'cli', 'src');
  let directory = __dirname;

  while (!existsSync(join(directory, marker))) {
    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`${marker} not found above ${__dirname}`);
    }
    directory = parent;
  }
  return directory;
}

/** Compares with the golden file; a missing one fails, so CI never writes one silently. */
export function assertGolden(file: string, actual: string): void {
  if (process.env[GoldenEnvVariable.Update] === '1') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  assert.ok(existsSync(file), `${file} is missing: run npm run golden:update`);
  assert.equal(
    actual,
    readFileSync(file, 'utf8'),
    `${file} differs; if the change is intended, run npm run golden:update and review the diff`,
  );
}
