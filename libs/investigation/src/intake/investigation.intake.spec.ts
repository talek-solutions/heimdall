import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { SystemGraph, type SystemGraph as ISystemGraph } from '@heimdall/core/graph';
import {
  FIXED_CLOCK,
  loadGraph,
  NOW,
  ReferenceManifest,
  testConfig,
} from '../__fixtures__/investigation.fixture';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import { parseDuration } from './duration';
import { InvestigationIntake } from './investigation.intake';

const intake = new InvestigationIntake(FIXED_CLOCK, testConfig());

function withEnvironments(names: readonly string[]): ISystemGraph {
  return new SystemGraph(
    {
      name: 'shop',
      environments: names.map((name) => ({ name, context: `${name}-context`, labels: {} })),
    },
    [],
    [],
  );
}

function rejectsWith(code: InvestigationErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof InvestigationError && error.errorCode === code;
}

describe('InvestigationIntake', () => {
  let graph: ISystemGraph;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Shop);
  });

  it('ends the window at the clock and compares it with the preceding one', () => {
    const { window } = intake.resolve(graph, { query: 'x', since: '30m' });

    assert.equal(window.end.toISOString(), NOW.toISOString());
    assert.equal(window.start.toISOString(), '2026-09-27T11:30:00.000Z');
    assert.equal(window.baseline.start.toISOString(), '2026-09-27T11:00:00.000Z');
    assert.equal(window.baseline.end.toISOString(), window.start.toISOString());
  });

  it('falls back to the configured lookback', () => {
    const { window } = intake.resolve(graph, { query: 'x' });

    assert.equal(window.start.toISOString(), '2026-09-27T11:00:00.000Z');
  });

  it('uses the only environment when none is named', () => {
    assert.deepEqual(intake.resolve(graph, { query: 'x' }).environment, {
      name: 'prod',
      context: 'prod',
    });
  });

  it('requires a choice when the system has several environments', () => {
    assert.throws(
      () => intake.resolve(withEnvironments(['prod', 'staging']), { query: 'x' }),
      rejectsWith(InvestigationErrorCode.EnvironmentUnknown),
    );
    assert.equal(
      intake.resolve(withEnvironments(['prod', 'staging']), { query: 'x', environment: 'staging' })
        .environment?.context,
      'staging-context',
    );
  });

  it('rejects an unknown environment, a bad window and an empty query', () => {
    assert.throws(
      () => intake.resolve(graph, { query: 'x', environment: 'qa' }),
      rejectsWith(InvestigationErrorCode.EnvironmentUnknown),
    );
    assert.throws(
      () => intake.resolve(graph, { query: 'x', since: 'yesterday' }),
      rejectsWith(InvestigationErrorCode.InvalidWindow),
    );
    assert.throws(
      () => intake.resolve(graph, { query: '   ' }),
      rejectsWith(InvestigationErrorCode.EmptyQuery),
    );
  });
});

describe('parseDuration', () => {
  it('reads seconds, minutes, hours and days', () => {
    assert.equal(parseDuration('45s'), 45_000);
    assert.equal(parseDuration('30m'), 1_800_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('1d'), 86_400_000);
  });

  it('rejects zero, fractions and bare numbers', () => {
    assert.equal(parseDuration('0m'), undefined);
    assert.equal(parseDuration('1.5h'), undefined);
    assert.equal(parseDuration('60'), undefined);
  });
});
