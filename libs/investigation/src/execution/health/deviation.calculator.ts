import { IndicatorRole } from '@heimdall/core/manifest';
import type { IMetricPoint } from '@heimdall/telemetry';
import type { IDeviationConfig } from '../../config/investigation-config.model';
import { DeviationDirection, PreliminarySignal } from './health.enums';

const MAD_SCALE = 1.4826;
/** Keeps a flat baseline from turning every wobble into a large z. */
const SPREAD_FLOOR = 0.01;
const EPSILON = 1e-12;
export const MIN_COVERAGE = 0.5;

/** A drop is a symptom and a surge can be a cause, so these deviate either way. */
const TWO_SIDED: ReadonlySet<IndicatorRole> = new Set([
  IndicatorRole.Throughput,
  IndicatorRole.Kpi,
]);

export interface IDeviationPeak {
  readonly value: number;
  readonly timestampMs: number;
  /** In the bad direction: positive means worse. */
  readonly z: number;
  /** Relative to the baseline median, signed as the value moved; infinite when the median is 0. */
  readonly effect: number;
  readonly direction: DeviationDirection;
}

export interface IDeviation {
  readonly signal: PreliminarySignal;
  readonly coverage: number;
  readonly baseline: { readonly median: number; readonly spread: number } | undefined;
  readonly peak: IDeviationPeak | undefined;
  readonly longestRun: number;
  readonly onsetMs: number | undefined;
}

interface IScoredPoint {
  readonly point: IMetricPoint;
  readonly badZ: number;
  readonly badEffect: number;
  readonly z: number;
  readonly effect: number;
}

/** The statistics of `.docs/design/health-evaluation.md`, Definitions; pure and deterministic. */
export class DeviationCalculator {
  constructor(private readonly config: IDeviationConfig) {}

  evaluate(
    window: readonly IMetricPoint[],
    baseline: readonly IMetricPoint[],
    expectedPoints: number,
    role: IndicatorRole,
  ): IDeviation {
    const present = window.filter(({ value }) => Number.isFinite(value));
    const reference = baseline.map(({ value }) => value).filter(Number.isFinite);
    const coverage = expectedPoints === 0 ? 0 : Math.min(1, present.length / expectedPoints);

    if (reference.length === 0 || coverage < MIN_COVERAGE) {
      return {
        signal: PreliminarySignal.NoData,
        coverage,
        baseline: undefined,
        peak: undefined,
        longestRun: 0,
        onsetMs: undefined,
      };
    }
    const median = medianOf(reference);
    const spread = Math.max(
      MAD_SCALE * medianOf(reference.map((value) => Math.abs(value - median))),
      SPREAD_FLOOR * Math.abs(median),
      EPSILON,
    );
    const scored = present.map((point) => this.score(point, median, spread, role));
    const { longestRun, onsetMs, deviating } = this.runs(scored);
    const peak = scored.reduce<IScoredPoint | undefined>(
      (best, candidate) => (best === undefined || candidate.badZ > best.badZ ? candidate : best),
      undefined,
    );

    return {
      signal:
        longestRun >= this.config.minRun
          ? PreliminarySignal.Anomalous
          : deviating
            ? PreliminarySignal.Borderline
            : PreliminarySignal.Normal,
      coverage,
      baseline: { median, spread },
      peak:
        peak === undefined
          ? undefined
          : {
              value: peak.point.value,
              timestampMs: peak.point.timestampMs,
              z: peak.badZ,
              effect: peak.effect,
              direction: peak.z < 0 ? DeviationDirection.Down : DeviationDirection.Up,
            },
      longestRun,
      onsetMs,
    };
  }

  private score(
    point: IMetricPoint,
    median: number,
    spread: number,
    role: IndicatorRole,
  ): IScoredPoint {
    const z = (point.value - median) / spread;
    const effect =
      median === 0
        ? point.value === 0
          ? 0
          : Math.sign(point.value) * Number.POSITIVE_INFINITY
        : (point.value - median) / Math.abs(median);
    const twoSided = TWO_SIDED.has(role);

    return {
      point,
      z,
      effect,
      badZ: twoSided ? Math.abs(z) : z,
      badEffect: twoSided ? Math.abs(effect) : effect,
    };
  }

  /** Longest run of deviating points, and where the first qualifying run starts. */
  private runs(scored: readonly IScoredPoint[]): {
    readonly longestRun: number;
    readonly onsetMs: number | undefined;
    readonly deviating: boolean;
  } {
    let run = 0;
    let longestRun = 0;
    let onsetMs: number | undefined;
    let deviating = false;

    for (const [index, entry] of scored.entries()) {
      if (entry.badZ >= this.config.z && entry.badEffect >= this.config.minEffect) {
        deviating = true;
        run += 1;
        longestRun = Math.max(longestRun, run);
        if (run === this.config.minRun && onsetMs === undefined) {
          onsetMs = scored[index - run + 1]?.point.timestampMs;
        }
      } else {
        run = 0;
      }
    }
    return { longestRun, onsetMs, deviating };
  }
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
