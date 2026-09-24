import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import {
  ConfigErrorCode,
  DEFAULT_CONFIG_YAML,
  ConfigEnvVariable,
  defaultConfigPath,
} from '@heimdall/config';

const ENTRY = path.join(__dirname, '..', '..', 'heimdall.js');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-config-'));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const VALID = `
version: 1
kind: Config
currentContext: prod
sources:
  - alias: prod-loki
    type: loki
    url: https://loki.example
  - alias: prod-grafana
    type: grafana
    url: https://grafana.example
    datasourceUid: abc123
    signal: traces
  - alias: staging-loki
    type: loki
    url: https://loki.staging.example
contexts:
  - name: prod
    sources: [prod-loki, prod-grafana]
  - name: staging
    sources: [staging-loki]
`;

interface ConfigSummary {
  readonly configPath: string;
  readonly sources: string[];
  readonly contexts: string[];
  readonly context: { name: string; sources: string[] } | null;
}

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

/**
 * HOME is always a throwaway directory so no spec can read or create the
 * developer's real ~/.heimdall.
 */
function invoke(env: NodeJS.ProcessEnv, ...args: string[]): Invocation {
  try {
    const stdout = execFileSync(process.execPath, [ENTRY, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env['PATH'], HOME: mkdtempSync(path.join(workspace, 'home-')), ...env },
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

function withConfig(file: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { [ConfigEnvVariable.ConfigPath]: file, ...extra };
}

describe('heimdall config (end to end)', () => {
  it('creates the default ~/.heimdall/config.yaml on first run', () => {
    const home = mkdtempSync(path.join(workspace, 'first-run-'));
    const { status, stdout } = invoke({ HOME: home }, 'config', '--json');

    assert.equal(status, ExitCode.Success);
    const file = defaultConfigPath(home);
    assert.equal(readFileSync(file, 'utf8'), DEFAULT_CONFIG_YAML);

    const summary = JSON.parse(stdout) as ConfigSummary;
    assert.equal(summary.configPath, file);
    assert.deepEqual(summary.sources, []);
    assert.equal(summary.context, null);
  });

  it('validates a good config and exits Success', () => {
    const file = writeConfig('valid.yaml', VALID);
    const { status, stdout } = invoke(withConfig(file), 'config');

    assert.equal(status, ExitCode.Success);
    assert.match(stdout, /prod-loki \(loki\)/);
    assert.match(stdout, /prod-grafana \(grafana:traces\)/);
    assert.match(stdout, /context: {3}prod -> prod-loki, prod-grafana/);
  });

  it('emits a machine-readable summary under --json', () => {
    const file = writeConfig('valid-json.yaml', VALID);
    const { status, stdout } = invoke(withConfig(file), 'config', '--json');

    assert.equal(status, ExitCode.Success);
    const summary = JSON.parse(stdout) as ConfigSummary;
    assert.deepEqual(summary.contexts, ['prod', 'staging']);
    assert.deepEqual(summary.context, { name: 'prod', sources: ['prod-loki', 'prod-grafana'] });
  });

  it('switches context with HEIMDALL_CONTEXT and, above it, --context', () => {
    const file = writeConfig('switch.yaml', VALID);
    const fromEnv = invoke(
      withConfig(file, { [ConfigEnvVariable.Context]: 'staging' }),
      'config',
      '--json',
    );
    const fromFlag = invoke(
      withConfig(file, { [ConfigEnvVariable.Context]: 'staging' }),
      'config',
      '--context',
      'prod',
      '--json',
    );

    assert.equal((JSON.parse(fromEnv.stdout) as ConfigSummary).context?.name, 'staging');
    assert.equal((JSON.parse(fromFlag.stdout) as ConfigSummary).context?.name, 'prod');
  });

  it('exits Usage when the selected context does not exist', () => {
    const file = writeConfig('missing-context.yaml', VALID);
    const { status, stderr } = invoke(withConfig(file), 'config', '--context', 'typo');

    assert.equal(status, ExitCode.Usage);
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigContextNotFound));
  });

  it('exits Usage and creates nothing when HEIMDALL_CONFIG points at a missing file', () => {
    const absent = path.join(workspace, 'absent.yaml');
    const { status, stdout, stderr } = invoke(withConfig(absent), 'config');

    assert.equal(status, ExitCode.Usage);
    assert.equal(stdout, '', 'diagnostics must never reach stdout');
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigFileNotFound));
    assert.equal(existsSync(absent), false);
  });

  it('exits Usage when the YAML is malformed', () => {
    const file = writeConfig('broken.yaml', 'sources: [unclosed\n');
    const { status, stderr } = invoke(withConfig(file), 'config');

    assert.equal(status, ExitCode.Usage);
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigParseFailed));
  });

  it('exits Usage when a context names an undeclared source', () => {
    const file = writeConfig('bad-ref.yaml', VALID.replace('[staging-loki]', '[typo]'));
    const { status, stderr } = invoke(withConfig(file), 'config');

    assert.equal(status, ExitCode.Usage);
    assert.match(stderr, new RegExp(ConfigErrorCode.ConfigInvalid));
  });

  it('reports failures on stdout as JSON when a machine format was requested', () => {
    // A caller parsing --json needs the error in the channel it is reading, in the
    // same shape as a success. Prose on stderr would be invisible to it.
    const { status, stdout } = invoke(
      withConfig(path.join(workspace, 'absent.yaml')),
      'config',
      '--context',
      'prod',
      '--json',
    );

    assert.equal(status, ExitCode.Usage);
    const response = JSON.parse(stdout) as { errorCode: string; message?: string };
    assert.equal(response.errorCode, ConfigErrorCode.ConfigFileNotFound);
  });
});
