import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import {
  loadScenario,
  MINIMAL_MANIFEST,
  removeScenarioRoots,
  TEST_SCENARIO,
  writeScenarios,
} from '../__fixtures__/scenario-files.fixture';
import { ScenarioFile } from './scenario.enums';
import { ScenarioLoader } from './scenario.loader';

const MINUTE = 60_000;

const RAMPING_METRICS = `
series:
  - id: checkout_p99
    match: 'histogram_quantile'
    labels: { service: checkout }
    curve:
      baseline: 0.2
      phases:
        - { shape: ramp, at: 90m, to: 2.2, over: 10m }
  - id: checkout_p99_ms
    match: 'p99_ms'
    curve: { ref: checkout_p99, scale: 1000 }
`;

function isInvalid(...fragments: string[]): (error: unknown) => boolean {
  return (error) =>
    error instanceof TelemetryError &&
    error.errorCode === TelemetryErrorCode.FixtureScenarioInvalid &&
    fragments.every((fragment) => error.message.includes(fragment));
}

describe('ScenarioLoader', () => {
  after(removeScenarioRoots);

  it('loads, validates and compiles a scenario', async () => {
    const scenario = await loadScenario({ [ScenarioFile.Metrics]: RAMPING_METRICS });

    assert.equal(scenario.name, TEST_SCENARIO);
    assert.equal(scenario.seed, 7);
    assert.equal(scenario.durationMs, 120 * MINUTE);
    assert.equal(scenario.resolutionMs, 15_000);
    assert.match(scenario.contentHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      scenario.metrics.map((series) => series.id),
      ['checkout_p99', 'checkout_p99_ms'],
    );
    assert.equal(scenario.metrics[0]?.curve.valueAt(100 * MINUTE), 2.2);
    assert.equal(scenario.metrics[1]?.curve.valueAt(0), 200);
  });

  it('treats a missing signal file as no data for that signal', async () => {
    const scenario = await loadScenario({});

    assert.deepEqual(scenario.metrics, []);
  });

  it('changes the content hash whenever a file changes', async () => {
    const one = await loadScenario({ [ScenarioFile.Metrics]: RAMPING_METRICS });
    const other = await loadScenario({ [ScenarioFile.Metrics]: `${RAMPING_METRICS}\n# edit\n` });

    assert.notEqual(one.contentHash, other.contentHash);
  });

  it('supports YAML anchors and merge keys within a file', async () => {
    const scenario = await loadScenario({
      [ScenarioFile.Metrics]: `
series:
  - id: first
    match: 'x'
    labels: &shop { namespace: shop, team: payments }
    curve: &flat { baseline: 3 }
  - id: second
    match: 'x'
    labels: { <<: *shop, team: checkout }
    curve: *flat
`,
    });

    assert.deepEqual(scenario.metrics[1]?.labels, { namespace: 'shop', team: 'checkout' });
    assert.equal(scenario.metrics[1]?.curve.valueAt(0), 3);
  });

  it('reports a missing scenario with the available ones', async () => {
    const root = await writeScenarios({ alpha: { [ScenarioFile.Manifest]: MINIMAL_MANIFEST }, beta: {} });

    await assert.rejects(
      new ScenarioLoader().load(root, 'gamma'),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.FixtureScenarioNotFound &&
        error.message.includes("'gamma'") &&
        error.message.includes('alpha, beta'),
    );
  });

  it('refuses a name that could escape the scenarios directory', async () => {
    await assert.rejects(
      new ScenarioLoader().load('/tmp', '../etc'),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.InvalidDatasourceConfig,
    );
  });

  it('reports YAML syntax errors with the file name', async () => {
    await assert.rejects(
      loadScenario({ [ScenarioFile.Metrics]: 'series: [\n' }),
      isInvalid(ScenarioFile.Metrics),
    );
  });

  it('reports schema violations with the field path, across files at once', async () => {
    await assert.rejects(
      loadScenario({
        [ScenarioFile.Manifest]: 'version: 2\nduration: soon\n',
        [ScenarioFile.Metrics]: `
series:
  - id: Bad-Id
    match: 'x'
    unexpected: true
    curve: { baseline: 1, phases: [{ shape: wobble, at: 1m }] }
`,
      }),
      isInvalid(
        'scenario.yaml: version',
        'scenario.yaml: duration',
        'metrics.yaml: series.0.id',
        'metrics.yaml: series.0.unexpected',
        'series.0.curve.phases.0.shape',
      ),
    );
  });

  it('reports invalid regexes, unknown refs, ref cycles and duplicate ids', async () => {
    await assert.rejects(
      loadScenario({
        [ScenarioFile.Metrics]: `
series:
  - { id: broken, match: '(', curve: { baseline: 1 } }
  - { id: orphan, match: 'x', curve: { ref: missing } }
  - { id: ping, match: 'x', curve: { ref: pong } }
  - { id: pong, match: 'x', curve: { ref: ping } }
  - { id: ping, match: 'x', curve: { baseline: 1 } }
`,
      }),
      isInvalid(
        'series.0.match',
        "unknown metric series 'missing'",
        'ref cycle',
        "duplicate id 'ping'",
      ),
    );
  });

  it('reports curves that are neither or both of baseline and ref, and misplaced phases', async () => {
    await assert.rejects(
      loadScenario({
        [ScenarioFile.Metrics]: `
series:
  - { id: target, match: 'x', curve: { baseline: 1 } }
  - { id: neither, match: 'x', curve: {} }
  - { id: both, match: 'x', curve: { baseline: 1, ref: target } }
  - id: late
    match: 'x'
    curve:
      baseline: 1
      phases:
        - { shape: ramp, at: 3h, to: 2 }
        - { shape: hold, at: 1h }
        - { shape: spike, at: 1h, to: 5, decay: 0s }
`,
      }),
      isInvalid(
        'series.1.curve: exactly one of baseline or ref',
        'series.2.curve: exactly one of baseline or ref',
        'phases.0.at: 3h is beyond the scenario duration',
        'phases.1.at: phases must be in time order',
        'phases.2.decay: must be longer than zero',
      ),
    );
  });
});
