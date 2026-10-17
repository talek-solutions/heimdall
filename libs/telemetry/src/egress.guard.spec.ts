import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

// dist/egress.guard.spec.js → the repository root.
const ROOT = path.resolve(__dirname, '../../..');
const TELEMETRY = path.join(ROOT, 'libs', 'telemetry');
const SKIPPED = new Set(['node_modules', 'dist', '.git']);
const RAW_IMPORT =
  /from\s+['"](@heimdall\/telemetry\/[^'"]+|[^'"]*telemetry\/src\/(connectors|fixture)[^'"]*)['"]/;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sources(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** ADR 0008: the engine has no way to obtain unredacted telemetry. */
describe('Egress guard', () => {
  it('exports only the redacting root of @heimdall/telemetry', () => {
    const manifest = JSON.parse(readFileSync(path.join(TELEMETRY, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };

    assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './package.json']);
  });

  it('has no code outside libs/telemetry reach into its connectors or fixtures', () => {
    const offenders = ['apps', 'libs']
      .flatMap((top) => sources(path.join(ROOT, top)))
      .filter((file) => !file.startsWith(`${TELEMETRY}${path.sep}`))
      .filter((file) => RAW_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));

    assert.deepEqual(offenders, []);
  });
});
