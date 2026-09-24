import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ConfigError, ConfigErrorCode } from './errors';
import { ConfigBootstrapper } from './config.bootstrapper';
import { defaultConfigPath } from './config.paths';
import { DEFAULT_CONFIG_YAML } from './default-config';

const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-bootstrap-'));
const bootstrapper = new ConfigBootstrapper();
const PERMISSION_BITS = 0o777;

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function freshHome(name: string): string {
  return path.join(workspace, name);
}

describe('ConfigBootstrapper', () => {
  it('creates ~/.heimdall/config.yaml with the default contents', async () => {
    const file = defaultConfigPath(freshHome('create'));

    assert.equal(await bootstrapper.ensureDefault(file), true);
    assert.equal(readFileSync(file, 'utf8'), DEFAULT_CONFIG_YAML);
  });

  it('restricts the directory and file to the owner', async () => {
    const file = defaultConfigPath(freshHome('modes'));
    await bootstrapper.ensureDefault(file);

    assert.equal(statSync(path.dirname(file)).mode & PERMISSION_BITS, 0o700);
    assert.equal(statSync(file).mode & PERMISSION_BITS, 0o600);
  });

  it('never overwrites an existing config', async () => {
    const file = defaultConfigPath(freshHome('existing'));
    await bootstrapper.ensureDefault(file);
    writeFileSync(file, 'user edits\n', 'utf8');

    assert.equal(await bootstrapper.ensureDefault(file), false);
    assert.equal(readFileSync(file, 'utf8'), 'user edits\n');
  });

  it('reports a coded error when the file cannot be written', async () => {
    const blocker = path.join(workspace, 'not-a-directory');
    writeFileSync(blocker, '', 'utf8');

    await assert.rejects(
      bootstrapper.ensureDefault(path.join(blocker, 'config.yaml')),
      (error: unknown) =>
        error instanceof ConfigError && error.errorCode === ConfigErrorCode.ConfigWriteFailed,
    );
  });
});
