import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { rmSync } from 'node:fs';
import { ExitCode } from '@heimdall/core';
import { ConfigErrorCode } from '@heimdall/telemetry';

const ENTRY = path.join(__dirname, '..', '..', 'heimdall.js');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-config-'));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const VALID = `
version: 1
backends:
  - name: prod-loki
    type: loki
    url: https://loki.example
queries:
  - name: service-errors
    backend: prod-loki
    signal: logs
    query: '{app="x"}'
    description: Error logs for one service
    fields:
      app: service
`;

function writeConfig(name: string, contents: string): string {
  const file = path.join(workspace, name);
  writeFileSync(file, contents, 'utf8');
  return file;
}

interface Invocation {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function invoke(...args: string[]): Invocation {
  try {
    const stdout = execFileSync(process.execPath, [ENTRY, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('heimdall config (end to end)', () => {
  it('validates a good config and exits Success', () => {
    const file = writeConfig('valid.yaml', VALID);
    const { status, stdout } = invoke('config', '-c', file);

    assert.equal(status, ExitCode.Success);
    assert.match(stdout, /prod-loki \(loki\)/);
  });

  it('emits a machine-readable summary under --json', () => {
    const file = writeConfig('valid-json.yaml', VALID);
    const { status, stdout } = invoke('config', '-c', file, '--json');

    assert.equal(status, ExitCode.Success);
    const summary = JSON.parse(stdout) as { backends: string[] };
    assert.deepEqual(summary.backends, ['prod-loki (loki)']);
  });

  it('exits Usage with a coded error when the config is missing', () => {
    const { status, stdout, stderr } = invoke(
      'config',
      '-c',
      path.join(workspace, 'absent.yaml'),
    );

    assert.equal(status, ExitCode.Usage);
    assert.equal(stdout, '', 'diagnostics must never reach stdout');
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigFileNotFound));
  });

  it('exits Usage when the YAML is malformed', () => {
    const file = writeConfig('broken.yaml', 'backends: [unclosed\n');
    const { status, stderr } = invoke('config', '-c', file);

    assert.equal(status, ExitCode.Usage);
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigParseFailed));
  });

  it('exits Usage when a query names an undeclared backend', () => {
    const file = writeConfig('bad-ref.yaml', VALID.replace('backend: prod-loki', 'backend: typo'));
    const { status, stderr } = invoke('config', '-c', file);

    assert.equal(status, ExitCode.Usage);
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigInvalid));
  });

  it('reports failures on stdout as JSON when a machine format was requested', () => {
    // A caller parsing --json needs the error in the channel it is reading, in the
    // same shape as a success. Prose on stderr would be invisible to it.
    const { status, stdout } = invoke(
      'config',
      '-c',
      path.join(workspace, 'absent.yaml'),
      '--json',
    );

    assert.equal(status, ExitCode.Usage);
    const response = JSON.parse(stdout) as { errorCode: string; message?: string };
    assert.equal(response.errorCode, ConfigErrorCode.ConfigFileNotFound);
  });
});
