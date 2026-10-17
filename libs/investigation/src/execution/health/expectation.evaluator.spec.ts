import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExpectationKind } from '@heimdall/core/manifest';
import type { IMetricPoint } from '@heimdall/telemetry';
import { ExpectationEvaluator } from './expectation.evaluator';
import { ObjectiveVerdict } from './health.enums';

const evaluator = new ExpectationEvaluator({ z: 3.5, minRun: 2, minEffect: 0.1 });

function series(values: readonly number[]): IMetricPoint[] {
  return values.map((value, index) => ({ timestampMs: index * 1_000, value }));
}

describe('ExpectationEvaluator: objective verdicts of health-evaluation.md', () => {
  it('breaches an SLO percentile after two consecutive points above it, dated at the first', () => {
    const slo = { kind: ExpectationKind.Slo, p99: 1 } as const;
    const breached = evaluator.evaluate(series([0.2, 1.4, 2.1, 0.3]), 4, slo, 0.99);
    const blip = evaluator.evaluate(series([0.2, 1.4, 0.2, 0.3]), 4, slo, 0.99);

    assert.deepEqual(breached, {
      verdict: ObjectiveVerdict.Breached,
      bounds: 'p99 ≤ 1',
      onsetMs: 1_000,
    });
    assert.equal(blip?.verdict, ObjectiveVerdict.Met);
  });

  it('meets the error-burst-30s place-order SLO at a 0.65s peak', () => {
    assert.equal(
      evaluator.evaluate(
        series([0.18, 0.65, 0.6, 0.2]),
        4,
        { kind: ExpectationKind.Slo, p99: 1 },
        0.99,
      )?.verdict,
      ObjectiveVerdict.Met,
    );
  });

  it('checks thresholds both ways, and every bound of an SLO', () => {
    const threshold = { kind: ExpectationKind.Threshold, min: 0.5, max: 30 } as const;
    const below = evaluator.evaluate(series([1, 0.2, 0.1]), 3, threshold, undefined);
    const ratio = evaluator.evaluate(
      series([0.995, 0.97, 0.96]),
      3,
      { kind: ExpectationKind.Slo, min: 0.99, max: 1 },
      undefined,
    );

    assert.equal(below?.verdict, ObjectiveVerdict.Breached);
    assert.equal(below?.bounds, '≥ 0.5, ≤ 30');
    assert.equal(ratio?.verdict, ObjectiveVerdict.Breached);
  });

  it('breaches nonZero on two zeros in a row', () => {
    const nonZero = { kind: ExpectationKind.NonZero } as const;

    assert.equal(
      evaluator.evaluate(series([3, 0, 0, 2]), 4, nonZero, undefined)?.verdict,
      ObjectiveVerdict.Breached,
    );
    assert.equal(
      evaluator.evaluate(series([3, 0, 2, 0]), 4, nonZero, undefined)?.verdict,
      ObjectiveVerdict.Met,
    );
  });

  it('reports no data below 50% coverage, and leaves baseline expectations to the agent', () => {
    const slo = { kind: ExpectationKind.Slo, p99: 1 } as const;

    assert.equal(evaluator.evaluate(series([5]), 4, slo, 0.99)?.verdict, ObjectiveVerdict.NoData);
    assert.equal(
      evaluator.evaluate(series([5, 5]), 2, { kind: ExpectationKind.Baseline }, undefined),
      undefined,
    );
  });
});
