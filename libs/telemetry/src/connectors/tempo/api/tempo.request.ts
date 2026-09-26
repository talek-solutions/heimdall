export interface TempoTraceRequest {
  /** Hex trace ID. */
  readonly traceId: string;
  readonly signal?: AbortSignal;
}

export interface TempoSearchRequest {
  /** TraceQL, passed through untouched (ADR 0005). */
  readonly query: string;
  readonly start?: Date;
  readonly end?: Date;
  /** Max traces; Tempo's own default applies when omitted. */
  readonly limit?: number;
  /** Max matching spans returned per span set. */
  readonly spansPerSpanSet?: number;
  readonly signal?: AbortSignal;
}
