export interface ILogsIdentityV1 {
  /** A LogQL stream selector, e.g. `{app="services-2"}`. */
  readonly selector: string;
  /**
   * Log field name → what it means. Doubles as the egress allowlist (ADR 0008): an
   * unmapped field never leaves the adapter.
   */
  readonly fields: Readonly<Record<string, string>>;
}

export interface IMetricsIdentityV1 {
  /** Label matchers that select this component's series, e.g. `{ job: services-2 }`. */
  readonly matchers: Readonly<Record<string, string>>;
}

export interface ITracesIdentityV1 {
  readonly serviceName: string;
}

/** How to find a component or member in each signal; a missing signal means none is emitted. */
export interface ITelemetryIdentityV1 {
  readonly logs?: ILogsIdentityV1 | undefined;
  readonly metrics?: IMetricsIdentityV1 | undefined;
  readonly traces?: ITracesIdentityV1 | undefined;
}
