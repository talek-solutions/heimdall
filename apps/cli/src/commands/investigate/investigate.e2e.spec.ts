import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import { ManifestEnvVariable, ManifestErrorCode } from '@heimdall/core/manifest';
import {
  CheckTier,
  EntryMethod,
  InvestigationErrorCode,
  InvestigationEventType,
  type IInvestigationPlan,
} from '@heimdall/investigation';
import { LlmErrorCode } from '@heimdall/llm';
import { TelemetryEnvVariable } from '@heimdall/telemetry';

const ENTRY = path.join(__dirname, '..', '..', 'heimdall.js');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-investigate-'));
const QUERY = 'checkouts are not working';
const ANCHOR = '2026-09-27T12:00:00.000Z';

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function checkoutManifest(): string {
  const relative = path.join('.docs', 'manifests', 'checkout', 'manifest.yaml');
  let directory = __dirname;

  while (!existsSync(path.join(directory, relative))) {
    directory = path.dirname(directory);
  }
  return path.join(directory, relative);
}

interface Invocation {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * HOME and the working directory are throwaway, so no spec reads the developer's
 * ~/.heimdall or a `.env` carrying a real API key.
 */
function invoke(env: NodeJS.ProcessEnv, ...args: string[]): Invocation {
  const { status, stdout, stderr } = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env['PATH'],
      HOME: mkdtempSync(path.join(workspace, 'home-')),
      [ManifestEnvVariable.ManifestPath]: checkoutManifest(),
      ...env,
    },
  });

  return { status: status ?? -1, stdout, stderr };
}

describe('heimdall investigate (end to end)', () => {
  it('plans from a named entry without a model, as one JSON object', () => {
    const { status, stdout } = invoke(
      {},
      'investigate',
      QUERY,
      '--entry',
      'functionality:checkout',
      '--plan-only',
      '--json',
    );

    assert.equal(status, ExitCode.Success);
    const plan = JSON.parse(stdout) as IInvestigationPlan;
    assert.equal(plan.query, QUERY);
    assert.equal(plan.system, 'storefront');
    assert.equal(plan.entry.method, EntryMethod.Flag);
    assert.deepEqual(plan.scope.suspectFlows, ['flow:place-order']);
    assert.equal(plan.checks[0]?.tier, CheckTier.Confirm);
  });

  it('streams each stage as NDJSON', () => {
    const { status, stdout } = invoke(
      {},
      'investigate',
      QUERY,
      '--entry',
      'functionality:checkout',
      '--ndjson',
    );

    assert.equal(status, ExitCode.Success);
    assert.deepEqual(
      stdout
        .trim()
        .split('\n')
        .map((line) => (JSON.parse(line) as { type: string }).type),
      [
        InvestigationEventType.Started,
        InvestigationEventType.SymptomClassified,
        InvestigationEventType.EntryLocated,
        InvestigationEventType.ScopeResolved,
        InvestigationEventType.PlanReady,
      ],
    );
  });

  it('prints the plan as text and says on stderr that it stops there, unless --plan-only', () => {
    const planned = invoke({}, 'investigate', QUERY, '--entry', 'functionality:checkout');
    const planOnly = invoke(
      {},
      'investigate',
      QUERY,
      '--entry',
      'functionality:checkout',
      '--plan-only',
    );

    assert.equal(planned.status, ExitCode.Success);
    assert.match(planned.stdout, /^investigation {2}checkouts are not working$/m);
    assert.match(planned.stdout, /component:orders-reconcile · logs/);
    assert.doesNotMatch(planned.stdout, /heimdall:/, 'progress must never reach stdout');
    assert.match(planned.stderr, /heimdall: entry: functionality:checkout \(flag\)/);
    assert.match(planned.stderr, /stopped after the plan/);
    assert.equal(planOnly.status, ExitCode.Success);
    assert.doesNotMatch(planOnly.stderr, /stopped after the plan/);
  });

  it('keeps progress off stderr under --quiet', () => {
    const { status, stderr } = invoke(
      {},
      'investigate',
      QUERY,
      '--entry',
      'functionality:checkout',
      '--quiet',
    );

    assert.equal(status, ExitCode.Success);
    assert.equal(stderr, '');
  });

  it('ends the window at the fixture anchor in fixture mode', () => {
    const { status, stdout } = invoke(
      {
        [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
        [TelemetryEnvVariable.FixtureScenario]: 'error-burst-30s',
        [TelemetryEnvVariable.FixtureAnchor]: ANCHOR,
      },
      'investigate',
      QUERY,
      '--entry',
      'functionality:checkout',
      '--since',
      '30s',
      '--json',
    );

    assert.equal(status, ExitCode.Success);
    const plan = JSON.parse(stdout) as { window: { start: string; end: string } };
    assert.deepEqual(plan.window, {
      start: '2026-09-27T11:59:30.000Z',
      end: ANCHOR,
      baseline: { start: '2026-09-27T11:59:00.000Z', end: '2026-09-27T11:59:30.000Z' },
    });
  });

  it('exits Usage for an entry that is not in the manifest, reporting JSON on stdout', () => {
    const { status, stdout } = invoke(
      {},
      'investigate',
      QUERY,
      '--entry',
      'component:nope',
      '--json',
    );

    assert.equal(status, ExitCode.Usage);
    assert.equal(
      (JSON.parse(stdout) as { errorCode: string }).errorCode,
      InvestigationErrorCode.EntryNotFound,
    );
  });

  it('exits Usage for an unknown environment or a missing manifest', () => {
    const environment = invoke(
      {},
      'investigate',
      QUERY,
      '--env',
      'staging',
      '--entry',
      'flow:place-order',
    );
    const manifest = invoke(
      { [ManifestEnvVariable.ManifestPath]: path.join(workspace, 'absent.yaml') },
      'investigate',
      QUERY,
    );

    assert.equal(environment.status, ExitCode.Usage);
    assert.match(environment.stderr, new RegExp(InvestigationErrorCode.EnvironmentUnknown));
    assert.equal(manifest.status, ExitCode.Usage);
    assert.match(manifest.stderr, new RegExp(ManifestErrorCode.ManifestFileNotFound));
  });

  it('asks the model when no entry is named, so it needs the provider key', () => {
    const { status, stderr } = invoke({}, 'investigate', QUERY);

    assert.equal(status, ExitCode.ProviderAuth);
    assert.match(stderr, new RegExp(LlmErrorCode.MISSING_API_KEY));
  });
});
