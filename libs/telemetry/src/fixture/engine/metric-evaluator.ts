import { PROMETHEUS_MAX_POINTS_PER_SERIES } from '../fixture-backend.constants';
import { FixtureRequestError } from '../fixture-backend';
import type { IMetricSeries } from '../scenario/scenario.model';
import { toWireSample } from './sample-format';
import type { Timeline } from './timeline';

export interface IWireVectorSample {
  readonly metric: Readonly<Record<string, string>>;
  readonly value: [number, string];
}

export interface IWireMatrixSeries {
  readonly metric: Readonly<Record<string, string>>;
  readonly values: [number, string][];
}

/** Vector and matrix results in the wire form Prometheus and Loki share. */
export class MetricEvaluator {
  constructor(private readonly timeline: Timeline) {}

  public vector(series: readonly IMetricSeries[], timeMs: number): IWireVectorSample[] {
    if (!this.timeline.hasData(timeMs)) {
      return [];
    }
    return series.map((entry) => ({
      metric: entry.labels,
      value: toWireSample(timeMs, entry.curve.valueAt(this.timeline.relative(timeMs))),
    }));
  }

  /** Caller validates the range; the point cap is shared, as both backends enforce the same one. */
  public matrix(
    series: readonly IMetricSeries[],
    startMs: number,
    endMs: number,
    stepMs: number,
  ): IWireMatrixSeries[] {
    if ((endMs - startMs) / stepMs > PROMETHEUS_MAX_POINTS_PER_SERIES) {
      throw new FixtureRequestError(
        'exceeded maximum resolution of 11,000 points per timeseries. Try decreasing the query resolution (?step=XX)',
      );
    }
    const timestamps = this.steps(startMs, Math.min(endMs, this.timeline.anchorMs), stepMs);

    if (timestamps.length === 0) {
      return [];
    }
    return series.map((entry) => ({
      metric: entry.labels,
      values: timestamps.map((timeMs) =>
        toWireSample(timeMs, entry.curve.valueAt(this.timeline.relative(timeMs))),
      ),
    }));
  }

  private steps(startMs: number, lastMs: number, stepMs: number): number[] {
    const timestamps: number[] = [];

    for (let index = 0; startMs + index * stepMs <= lastMs; index += 1) {
      timestamps.push(startMs + index * stepMs);
    }
    return timestamps;
  }
}
