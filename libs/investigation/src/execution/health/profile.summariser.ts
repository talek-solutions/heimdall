import type { IMetricPoint } from '@heimdall/telemetry';
import type { IDeviationConfig } from '../../config/investigation-config.model';
import type { IDeviation } from './deviation.calculator';
import { DeviationDirection, ProfileShape, ProfileState } from './health.enums';

/** Points a profile keeps: enough to see a shape, few enough to read at a glance. */
export const PROFILE_BUCKETS = 12;
/** How close to the peak counts as being there: for the rise, and for the state at the end. */
const NEAR_PEAK = 0.8;
/** The longest excursion, in buckets, that reads as a spike once it falls back. */
const SPIKE_BUCKETS = 3;
const SIGNIFICANT_DIGITS = 4;

/** The window's series in a few points: for the local report only, the agent never sees it. */
export interface IProfile {
  /** One per bucket: the worst value in the deviation's direction, `null` where a bucket is empty. */
  readonly points: readonly (number | null)[];
  readonly bucketSeconds: number;
  readonly shape: ProfileShape;
  /** `null` when nothing deviates. */
  readonly state: ProfileState | null;
  /** The last value in the window. */
  readonly last: number | null;
}

interface IBucketed {
  readonly values: readonly (number | null)[];
  readonly last: number | null;
}

/**
 * Buckets keep the worst value rather than the mean, so a burst shorter than a bucket still shows.
 * A bucket deviates by the thresholds of the deviation calculator.
 */
export class ProfileSummariser {
  constructor(private readonly config: IDeviationConfig) {}

  summarise(
    points: readonly IMetricPoint[],
    window: { readonly start: Date; readonly end: Date },
    deviation: IDeviation,
  ): IProfile | undefined {
    const { baseline, peak } = deviation;

    if (baseline === undefined || peak === undefined) {
      return undefined;
    }
    const up = peak.direction === DeviationDirection.Up;
    const startMs = window.start.getTime();
    const bucketMs = (window.end.getTime() - startMs) / PROFILE_BUCKETS;
    const { values, last } = this.bucket(points, startMs, bucketMs, up);
    const distance = (value: number): number =>
      up ? value - baseline.median : baseline.median - value;
    const deviates = (value: number | null | undefined): boolean =>
      value !== null &&
      value !== undefined &&
      distance(value) / baseline.spread >= this.config.z &&
      distance(value) / Math.abs(baseline.median) >= this.config.minEffect;
    const profile = {
      points: values.map((value) => (value === null ? null : round(value))),
      bucketSeconds: bucketMs / 1_000,
      last: last === null ? null : round(last),
    };
    const worst = values.reduce<number | undefined>(
      (best, value, index) =>
        value !== null && (best === undefined || distance(value) > distance(values[best] ?? 0))
          ? index
          : best,
      undefined,
    );

    if (worst === undefined || !deviates(values[worst])) {
      return { ...profile, shape: ProfileShape.Flat, state: null };
    }
    let first = worst;
    let end = worst;

    while (first > 0 && deviates(values[first - 1])) {
      first -= 1;
    }
    while (end < values.length - 1 && deviates(values[end + 1])) {
      end += 1;
    }
    const near = NEAR_PEAK * distance(values[worst] ?? 0);
    const reached = values.findIndex(
      (value, index) => index >= first && value !== null && distance(value) >= near,
    );
    const final = values.findLast((value) => value !== null) ?? null;
    const state = !deviates(final)
      ? ProfileState.Recovered
      : distance(final ?? 0) >= near
        ? ProfileState.Ongoing
        : ProfileState.Recovering;

    return {
      ...profile,
      shape:
        end - first + 1 <= SPIKE_BUCKETS && state !== ProfileState.Ongoing
          ? ProfileShape.Spike
          : reached - first <= 1
            ? ProfileShape.Step
            : ProfileShape.Ramp,
      state,
    };
  }

  private bucket(
    points: readonly IMetricPoint[],
    startMs: number,
    bucketMs: number,
    up: boolean,
  ): IBucketed {
    const values: (number | null)[] = Array.from({ length: PROFILE_BUCKETS }, () => null);
    const endMs = startMs + bucketMs * PROFILE_BUCKETS;
    let last: IMetricPoint | undefined;

    for (const point of points) {
      const { timestampMs, value } = point;

      if (!Number.isFinite(value) || timestampMs < startMs || timestampMs > endMs) {
        continue;
      }
      // The window's end point belongs to the last bucket.
      const index = Math.min(PROFILE_BUCKETS - 1, Math.floor((timestampMs - startMs) / bucketMs));
      const current = values[index] ?? null;

      values[index] =
        current === null ? value : up ? Math.max(current, value) : Math.min(current, value);
      if (last === undefined || timestampMs >= last.timestampMs) {
        last = point;
      }
    }
    return { values, last: last?.value ?? null };
  }
}

function round(value: number): number {
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}
