import { ExpectationKind, type IExpectationV1 } from '@heimdall/core/manifest';
import type { IMetricPoint } from '@heimdall/telemetry';
import type { IDeviationConfig } from '../../config/investigation-config.model';
import { MIN_COVERAGE } from './deviation.calculator';
import { ObjectiveVerdict } from './health.enums';

/** The SLO percentile keys a latency template can compute, highest first. */
export const SLO_PERCENTILES = [
  ['p99', 0.99],
  ['p95', 0.95],
  ['p90', 0.9],
  ['p50', 0.5],
] as const;

export interface IObjectiveResult {
  readonly verdict: ObjectiveVerdict;
  /** The bounds checked, e.g. `p99 ≤ 1`. */
  readonly bounds: string;
  readonly onsetMs: number | undefined;
}

interface IBounds {
  readonly lower: number | undefined;
  readonly upper: number | undefined;
  readonly nonZero: boolean;
  readonly text: string;
}

/**
 * Objective verdicts (`.docs/design/health-evaluation.md`, Objective verdicts): a bound is breached
 * by `minRun` consecutive points beyond it, so a one-point blip never breaches anything.
 */
export class ExpectationEvaluator {
  constructor(private readonly config: IDeviationConfig) {}

  /** `undefined` for `baseline`: that verdict is the agent's. */
  evaluate(
    window: readonly IMetricPoint[],
    expectedPoints: number,
    expectation: IExpectationV1,
    quantile: number | undefined,
  ): IObjectiveResult | undefined {
    const bounds = boundsOf(expectation, quantile);

    if (bounds === undefined) {
      return undefined;
    }
    const present = window.filter(({ value }) => Number.isFinite(value));

    if (expectedPoints === 0 || present.length / expectedPoints < MIN_COVERAGE) {
      return { verdict: ObjectiveVerdict.NoData, bounds: bounds.text, onsetMs: undefined };
    }
    let run = 0;

    for (const [index, point] of present.entries()) {
      run = violates(point.value, bounds) ? run + 1 : 0;
      if (run === this.config.minRun) {
        return {
          verdict: ObjectiveVerdict.Breached,
          bounds: bounds.text,
          onsetMs: present[index - run + 1]?.timestampMs,
        };
      }
    }
    return { verdict: ObjectiveVerdict.Met, bounds: bounds.text, onsetMs: undefined };
  }
}

function boundsOf(expectation: IExpectationV1, quantile: number | undefined): IBounds | undefined {
  switch (expectation.kind) {
    case ExpectationKind.Baseline:
      return undefined;
    case ExpectationKind.NonZero:
      return { lower: undefined, upper: undefined, nonZero: true, text: '≠ 0' };
    case ExpectationKind.Threshold:
      return bounds(expectation.min, expectation.max, undefined);
    case ExpectationKind.Slo: {
      const percentile = SLO_PERCENTILES.find(([, value]) => value === quantile)?.[0];
      const bound = percentile === undefined ? undefined : expectation[percentile];

      return bounds(
        expectation.min,
        expectation.max,
        percentile === undefined || bound === undefined ? undefined : { percentile, bound },
      );
    }
  }
}

function bounds(
  min: number | undefined,
  max: number | undefined,
  percentile: { readonly percentile: string; readonly bound: number } | undefined,
): IBounds {
  const uppers = [percentile?.bound, max].filter((value) => value !== undefined);
  const text = [
    ...(percentile === undefined ? [] : [`${percentile.percentile} ≤ ${percentile.bound}`]),
    ...(min === undefined ? [] : [`≥ ${min}`]),
    ...(max === undefined ? [] : [`≤ ${max}`]),
  ].join(', ');

  return {
    lower: min,
    upper: uppers.length === 0 ? undefined : Math.min(...uppers),
    nonZero: false,
    text,
  };
}

function violates(value: number, bounds: IBounds): boolean {
  if (bounds.nonZero) {
    return value === 0;
  }
  return (
    (bounds.upper !== undefined && value > bounds.upper) ||
    (bounds.lower !== undefined && value < bounds.lower)
  );
}
