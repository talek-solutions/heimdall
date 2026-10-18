import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import { ManifestEnvVariable } from '@heimdall/core/manifest';
import { LlmErrorCode } from '@heimdall/llm';
import { TelemetryEnvVariable } from '@heimdall/telemetry';
import { ReplayOutcome, TranscriptErrorCode } from '@heimdall/transcript';

const ENTRY = path.join(__dirname, '..', '..', 'heimdall.js');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-replay-e2e-'));
const FIXTURES = {
  [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
  [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
  [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
  [TelemetryEnvVariable.FixtureScenario]: 'error-burst-30s',
  [TelemetryEnvVariable.FixtureAnchor]: '2026-10-17T08:00:00.000Z',
};

after(() => rmSync(workspace, { recursive: true, force: true }));

function checkoutManifest(): string {
  const relative = path.join('.docs', 'manifests', 'checkout', 'manifest.yaml');
  let directory = __dirname;

  while (!existsSync(path.join(directory, relative))) {
    directory = path.dirname(directory);
  }
  return path.join(directory, relative);
}

/** A throwaway HOME and working directory, so nothing reads the developer's ~/.heimdall or `.env`. */
function invoke(home: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'], HOME: home, ...env },
  });
  return { status: status ?? -1, stdout, stderr };
}

/** No API key: the agent's first model call fails, which is a run worth recording too. */
function record(home: string, ...extra: string[]) {
  return invoke(
    home,
    { [ManifestEnvVariable.ManifestPath]: checkoutManifest(), ...FIXTURES },
    'investigate',
    'checkouts are not working',
    '--entry',
    'functionality:checkout',
    '--since',
    '2m',
    ...extra,
  );
}

function runs(home: string): string[] {
  const directory = path.join(home, '.heimdall', 'runs');
  return existsSync(directory)
    ? readdirSync(directory).map((name) => path.join(directory, name))
    : [];
}

describe('heimdall investigate records, heimdall replay replays (end to end)', () => {
  it('records every run in ~/.heimdall/runs, and not with --no-record', () => {
    const home = mkdtempSync(path.join(workspace, 'home-'));
    const recorded = record(home);

    assert.equal(recorded.status, ExitCode.ProviderAuth);
    assert.match(recorded.stderr, /heimdall: transcript .*\.heimdall\/runs\/.*\.json/);
    assert.equal(runs(home).length, 1);

    const quiet = mkdtempSync(path.join(workspace, 'home-'));
    record(quiet, '--no-record');
    assert.deepEqual(runs(quiet), []);
  });

  it('replays a recording with no model and no backend, and exits 0 when it matches', () => {
    const home = mkdtempSync(path.join(workspace, 'home-'));
    record(home);
    const [file = ''] = runs(home);
    const text = invoke(home, {}, 'replay', file);
    const json = invoke(home, {}, 'replay', file, '--json');

    assert.equal(text.status, ExitCode.Success, text.stderr);
    assert.match(text.stdout, /MATCHED/);
    assert.equal(JSON.parse(json.stdout).outcome, ReplayOutcome.Matched);
  });

  it('exits 6 when the replayed run does not reproduce the recording', () => {
    const home = mkdtempSync(path.join(workspace, 'home-'));
    record(home);
    const [file = ''] = runs(home);
    const transcript = JSON.parse(readFileSync(file, 'utf8')) as {
      outcome: { error: { errorCode: string } };
    };
    const edited = path.join(workspace, 'edited.json');

    // The recording says the run ended differently from how the replayed one does.
    transcript.outcome.error.errorCode = LlmErrorCode.RATE_LIMITED;
    writeFileSync(edited, JSON.stringify(transcript));
    const { status, stdout } = invoke(home, {}, 'replay', edited, '--json');

    assert.equal(status, ExitCode.ReplayDiverged);
    assert.equal(JSON.parse(stdout).outcome, ReplayOutcome.Diverged);
  });

  it('says there is no transcript, with exit 2', () => {
    const home = mkdtempSync(path.join(workspace, 'home-'));
    const { status, stdout } = invoke(
      home,
      {},
      'replay',
      path.join(workspace, 'none.json'),
      '--json',
    );

    assert.equal(status, ExitCode.Usage);
    assert.equal(JSON.parse(stdout).errorCode, TranscriptErrorCode.NotFound);
  });
});
