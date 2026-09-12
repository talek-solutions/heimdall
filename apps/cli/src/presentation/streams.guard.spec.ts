import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SOURCE_ROOTS = ['apps', 'libs'];

/** The single module allowed to write to the process streams. */
const CHOKE_POINT = path.join('presentation', 'streams.ts');

/**
 * Spec files legitimately spawn the CLI and inspect its output, and the guard
 * itself names the forbidden patterns.
 */
const EXEMPT_SUFFIXES = ['.spec.ts'];

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  { pattern: /\bconsole\s*\./, description: 'console.*' },
  { pattern: /\bprocess\s*\.\s*stdout\b/, description: 'process.stdout' },
  { pattern: /\bprocess\s*\.\s*stderr\b/, description: 'process.stderr' },
];

function typescriptFilesUnder(directory: string): string[] {
  const entries = readdirSync(directory);
  const collected: string[] = [];

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      collected.push(...typescriptFilesUnder(full));
    } else if (entry.endsWith('.ts')) {
      collected.push(full);
    }
  }
  return collected;
}

function isExempt(file: string): boolean {
  return (
    file.endsWith(CHOKE_POINT) ||
    EXEMPT_SUFFIXES.some((suffix) => file.endsWith(suffix))
  );
}

describe('stdout discipline is structurally enforced', () => {
  it('keeps process stream access confined to presentation/streams.ts', () => {
    // .docs/adr/0006 makes stdout data-only. This is a test rather than a lint
    // rule because typescript-eslint does not yet support TypeScript 7 (ADR 0012)
    // — and because a test cannot be waved through with an inline disable comment.
    const violations: string[] = [];

    for (const root of SOURCE_ROOTS) {
      for (const file of typescriptFilesUnder(path.join(REPO_ROOT, root))) {
        if (isExempt(file)) {
          continue;
        }
        const contents = readFileSync(file, 'utf8');

        for (const { pattern, description } of FORBIDDEN) {
          if (pattern.test(contents)) {
            violations.push(`${path.relative(REPO_ROOT, file)}: ${description}`);
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `write through the injected Streams provider instead:\n  ${violations.join('\n  ')}`,
    );
  });

  it('actually scans a non-trivial number of files', () => {
    // Guards against the scan silently matching nothing after a layout change,
    // which would make the test above pass for the wrong reason.
    const scanned = SOURCE_ROOTS.flatMap((root) =>
      typescriptFilesUnder(path.join(REPO_ROOT, root)),
    ).filter((file) => !isExempt(file));

    assert.ok(scanned.length >= 20, `only scanned ${scanned.length} files`);
  });
});
