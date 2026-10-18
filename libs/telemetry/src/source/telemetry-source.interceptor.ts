/** A redacting source's public operations, as an interceptor names them. */
export enum TelemetryOperation {
  MetricsQueryRange = 'metrics.queryRange',
  LogsQueryRange = 'logs.queryRange',
  TracesSearch = 'traces.search',
  TracesTrace = 'traces.trace',
}

export interface ITelemetryCall {
  readonly operation: TelemetryOperation;
  /** The source's URL: the same query against two sources is two calls. */
  readonly source: string;
  /** The request as plain JSON: dates as ISO strings, no abort signal. */
  readonly request: Readonly<Record<string, unknown>>;
}

/**
 * Sees every source call and its redacted result: records it, or answers it from a recording
 * (ADR 0007). It sits above redaction, so it never sees raw telemetry (ADR 0008).
 */
export interface ITelemetrySourceInterceptor {
  intercept<T>(call: ITelemetryCall, run: () => Promise<T>): Promise<T>;
}

export function intercept<T>(
  interceptor: ITelemetrySourceInterceptor | undefined,
  call: ITelemetryCall,
  run: () => Promise<T>,
): Promise<T> {
  return interceptor === undefined ? run() : interceptor.intercept(call, run);
}
