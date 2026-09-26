/** Metric shapes shared by PromQL and LogQL metric queries. */
export interface MetricSample {
  readonly timestampMs: number;
  /** Parsed from the backend's string form; `NaN` and `±Infinity` are preserved. */
  readonly value: number;
}

export interface MetricSeries {
  readonly labels: Readonly<Record<string, string>>;
  readonly samples: readonly MetricSample[];
}

export interface MetricVectorSample {
  readonly labels: Readonly<Record<string, string>>;
  readonly sample: MetricSample;
}
