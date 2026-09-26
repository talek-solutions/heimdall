export interface PrometheusInstantQueryRequest {
  /** PromQL, passed through untouched (ADR 0005). */
  readonly query: string;
  /** Evaluation time; defaults to now on the server. */
  readonly time?: Date;
  readonly signal?: AbortSignal;
}

export interface PrometheusRangeQueryRequest {
  readonly query: string;
  readonly start: Date;
  readonly end: Date;
  /** Required by Prometheus for range queries. */
  readonly stepSeconds: number;
  readonly signal?: AbortSignal;
}
