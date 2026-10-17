import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { AuthScheme } from '@heimdall/config';
import type { SystemGraph } from '@heimdall/core/graph';
import { IndicatorRole } from '@heimdall/core/manifest';
import {
  MetricsSource,
  TelemetryEnvVariable,
  TelemetrySourceModule,
  type IConnectorSource,
  type IMetricPoint,
} from '@heimdall/telemetry';
import { loadGraph, ReferenceManifest } from '../../__fixtures__/investigation.fixture';
import { PromQlCompiler } from '../queries/promql.compiler';
import { queryWindow } from '../queries/step-policy';
import { DeviationCalculator } from './deviation.calculator';
import { DeviationDirection, PreliminarySignal } from './health.enums';

const calculator = new DeviationCalculator({ z: 3.5, minRun: 2, minEffect: 0.1 });

function series(values: readonly number[], startMs = 0): IMetricPoint[] {
  return values.map((value, index) => ({ timestampMs: startMs + index * 1_000, value }));
}

const BASELINE = series([10, 10.2, 9.8, 10.1, 9.9, 10, 10.3, 9.7]);

describe('DeviationCalculator: the rules of health-evaluation.md', () => {
  it('needs two consecutive deviating points before calling a series anomalous, and dates the onset at the first', () => {
    const result = calculator.evaluate(
      series([10, 10, 30, 31, 10], 100_000),
      BASELINE,
      5,
      IndicatorRole.Errors,
    );

    assert.equal(result.signal, PreliminarySignal.Anomalous);
    assert.equal(result.longestRun, 2);
    assert.equal(result.onsetMs, 102_000);
    assert.equal(result.peak?.value, 31);
    assert.equal(result.peak?.direction, DeviationDirection.Up);
  });

  it('calls a single deviating point borderline', () => {
    const result = calculator.evaluate(series([10, 30, 10, 10]), BASELINE, 4, IndicatorRole.Errors);

    assert.equal(result.signal, PreliminarySignal.Borderline);
    assert.equal(result.onsetMs, undefined);
  });

  it('requires the effect as well as the z-score', () => {
    // A quiet baseline makes a 5% move a large z, but not an effect of 10%.
    const quiet = series([100, 100, 100, 100.01, 99.99, 100]);
    const result = calculator.evaluate(series([105, 105, 105]), quiet, 3, IndicatorRole.Latency);

    assert.equal(result.signal, PreliminarySignal.Normal);
  });

  it('floors the spread at 1% of the median, so a flat baseline does not inflate every wobble', () => {
    const flat = series([200, 200, 200, 200]);
    const result = calculator.evaluate(series([204, 204]), flat, 2, IndicatorRole.Latency);

    assert.equal(result.baseline?.spread, 2);
    assert.equal(result.peak?.z, 2);
    assert.equal(result.signal, PreliminarySignal.Normal);
  });

  it('treats any change from an all-zero baseline as an infinite effect', () => {
    const zero = series([0, 0, 0, 0]);
    const result = calculator.evaluate(series([0, 3, 4]), zero, 3, IndicatorRole.Errors);

    assert.equal(result.signal, PreliminarySignal.Anomalous);
    assert.equal(result.peak?.effect, Number.POSITIVE_INFINITY);
  });

  it('only counts errors, latency, saturation and lag going up, but throughput and KPIs either way', () => {
    const drop = series([5, 5, 5]);

    assert.equal(
      calculator.evaluate(drop, BASELINE, 3, IndicatorRole.Latency).signal,
      PreliminarySignal.Normal,
    );
    const throughput = calculator.evaluate(drop, BASELINE, 3, IndicatorRole.Throughput);
    assert.equal(throughput.signal, PreliminarySignal.Anomalous);
    assert.equal(throughput.peak?.direction, DeviationDirection.Down);
  });

  it('reports no data below 50% coverage or without a baseline, before anything else', () => {
    const sparse = calculator.evaluate(series([30, 30]), BASELINE, 5, IndicatorRole.Errors);
    const blind = calculator.evaluate(series([30, 30, 30]), [], 3, IndicatorRole.Errors);
    const gaps = calculator.evaluate(
      series([Number.NaN, Number.NaN, 30]),
      BASELINE,
      3,
      IndicatorRole.Errors,
    );

    for (const result of [sparse, blind, gaps]) {
      assert.equal(result.signal, PreliminarySignal.NoData);
    }
  });
});

const ANCHOR = '2026-10-17T08:00:00.000Z';
const SOURCE: IConnectorSource = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 5_000,
  auth: { scheme: AuthScheme.None },
};

interface ICalibration {
  readonly scenario: string;
  readonly name: string;
  readonly subject: string;
  readonly role: IndicatorRole;
  readonly minutes: number;
  readonly signal: PreliminarySignal;
  readonly run?: number;
  /** Seconds before the anchor. */
  readonly onset?: number;
  readonly z?: number;
}

/** The Worked examples table of health-evaluation.md, row for row. */
const CALIBRATION: readonly ICalibration[] = [
  {
    scenario: 'error-burst-30s',
    name: 'err_60',
    subject: 'step:place-order#1',
    role: IndicatorRole.Errors,
    minutes: 60,
    signal: PreliminarySignal.Anomalous,
    run: 2,
    onset: 15,
    z: 141.5,
  },
  {
    scenario: 'error-burst-30s',
    name: 'err_2',
    subject: 'step:place-order#1',
    role: IndicatorRole.Errors,
    minutes: 2,
    signal: PreliminarySignal.Anomalous,
    run: 25,
    onset: 24,
    z: 637.7,
  },
  {
    scenario: 'error-burst-30s',
    name: 'p99_60',
    subject: 'flow:place-order',
    role: IndicatorRole.Latency,
    minutes: 60,
    signal: PreliminarySignal.Borderline,
    run: 1,
    z: 7.5,
  },
  {
    scenario: 'error-burst-30s',
    name: 'p99_2',
    subject: 'flow:place-order',
    role: IndicatorRole.Latency,
    minutes: 2,
    signal: PreliminarySignal.Anomalous,
    run: 14,
    onset: 24,
    z: 43.4,
  },
  {
    scenario: 'error-burst-30s',
    name: 'rps_2',
    subject: 'functionality:checkout',
    role: IndicatorRole.Kpi,
    minutes: 2,
    signal: PreliminarySignal.Anomalous,
    run: 4,
    onset: 24,
    z: 5.8,
  },
  {
    scenario: 'error-burst-30s',
    name: 'tot_2',
    subject: 'step:place-order#1',
    role: IndicatorRole.Throughput,
    minutes: 2,
    signal: PreliminarySignal.Normal,
    run: 0,
  },
  {
    scenario: 'increased-latency-1',
    name: 'p99_60',
    subject: 'flow:place-order',
    role: IndicatorRole.Latency,
    minutes: 60,
    signal: PreliminarySignal.Anomalous,
    run: 120,
    onset: 1785,
    z: 173.9,
  },
  {
    scenario: 'increased-latency-1',
    name: 'err_60',
    subject: 'step:place-order#1',
    role: IndicatorRole.Errors,
    minutes: 60,
    signal: PreliminarySignal.Anomalous,
    run: 112,
    onset: 1665,
    z: 192.6,
  },
  {
    scenario: 'increased-latency-1',
    name: 'rps_60',
    subject: 'functionality:checkout',
    role: IndicatorRole.Kpi,
    minutes: 60,
    signal: PreliminarySignal.Anomalous,
    run: 91,
    onset: 1425,
    z: 9.3,
  },
  {
    scenario: 'healthy-baseline',
    name: 'err_60',
    subject: 'step:place-order#1',
    role: IndicatorRole.Errors,
    minutes: 60,
    signal: PreliminarySignal.Borderline,
    run: 1,
  },
  {
    scenario: 'healthy-baseline',
    name: 'p99_60',
    subject: 'flow:place-order',
    role: IndicatorRole.Latency,
    minutes: 60,
    signal: PreliminarySignal.Normal,
    run: 0,
  },
  {
    scenario: 'healthy-baseline',
    name: 'rps_60',
    subject: 'functionality:checkout',
    role: IndicatorRole.Kpi,
    minutes: 60,
    signal: PreliminarySignal.Normal,
    run: 0,
  },
];

describe('DeviationCalculator against the fixture scenarios (health-evaluation.md, Worked examples)', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Checkout);
  });

  after(() => {
    delete process.env[TelemetryEnvVariable.PrometheusDatasourceType];
    delete process.env[TelemetryEnvVariable.FixtureScenario];
    delete process.env[TelemetryEnvVariable.FixtureAnchor];
  });

  for (const row of CALIBRATION) {
    it(`${row.scenario} ${row.name}: ${row.signal}`, async () => {
      process.env[TelemetryEnvVariable.PrometheusDatasourceType] = 'fixture';
      process.env[TelemetryEnvVariable.FixtureScenario] = row.scenario;
      process.env[TelemetryEnvVariable.FixtureAnchor] = ANCHOR;
      const metrics = (
        await Test.createTestingModule({ imports: [TelemetrySourceModule] }).compile()
      ).get(MetricsSource);
      const end = new Date(ANCHOR);
      const window = queryWindow({ start: new Date(end.getTime() - row.minutes * 60_000), end }, 1);
      const indicator = graph.indicatorsOf(row.subject)[0];
      assert.ok(indicator);
      const compiled = new PromQlCompiler().compile(
        graph,
        indicator,
        row.role,
        {},
        window.rateWindowSeconds,
      );
      assert.ok(compiled.ok);
      const request = {
        query: compiled.compiled.query,
        stepSeconds: window.stepSeconds,
        labels: [],
      };
      const [current] = await metrics.queryRange(SOURCE, {
        ...request,
        start: window.start,
        end: window.end,
      });
      const [baseline] = await metrics.queryRange(SOURCE, {
        ...request,
        start: window.baselineStart,
        end: window.start,
      });
      const result = calculator.evaluate(
        current?.points ?? [],
        baseline?.points ?? [],
        window.expectedPoints,
        row.role,
      );

      assert.equal(result.signal, row.signal);
      if (row.run !== undefined) {
        assert.equal(result.longestRun, row.run);
      }
      if (row.onset !== undefined) {
        assert.equal(result.onsetMs, end.getTime() - row.onset * 1_000);
      }
      if (row.z !== undefined) {
        assert.ok(Math.abs((result.peak?.z ?? 0) - row.z) < 0.1, `z ${result.peak?.z} ≈ ${row.z}`);
      }
    });
  }
});
