export interface IMetricsRangeQuery {
  /** PromQL, built by the caller from the manifest (ADR 0018). */
  readonly query: string;
  readonly start: Date;
  readonly end: Date;
  readonly stepSeconds: number;
  /** Label names a series may keep; every other label is dropped before it leaves (ADR 0008). */
  readonly labels: readonly string[];
  readonly signal?: AbortSignal;
}

export interface IMetricPoint {
  readonly timestampMs: number;
  readonly value: number;
}

export interface IMetricSeriesData {
  readonly labels: Readonly<Record<string, string>>;
  readonly points: readonly IMetricPoint[];
}
