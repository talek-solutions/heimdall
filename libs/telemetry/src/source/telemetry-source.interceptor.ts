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
  /**
   * The results this call serves (ADR 0020): for whoever records the call, never part of what
   * makes two calls the same call, and never sent to a backend.
   */
  readonly resultIds?: readonly string[] | undefined;
}

/** What a caller says about a call besides its request. */
export interface ITelemetryCallContext {
  /** The ids of the results the call is made for; at least one. */
  readonly resultIds: readonly string[];
}

/** A call as an interceptor sees it: the request, and the caller's context when it gave one. */
export function describeCall(
  call: Omit<ITelemetryCall, 'resultIds'>,
  context: ITelemetryCallContext | undefined,
): ITelemetryCall {
  return context === undefined ? call : { ...call, resultIds: context.resultIds };
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
