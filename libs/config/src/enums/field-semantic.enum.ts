/**
 * What a field from a backend response *means*.
 *
 * This is the load-bearing half of the config (ADR 0005). Fetching logs is easy;
 * the model reasons markedly better over fields labelled with their meaning than
 * over an undifferentiated blob. It is also what the egress allowlist keys off
 * (ADR 0008) — an unmapped field is, by construction, a field that never leaves.
 */
export enum FieldSemantic {
  Timestamp = 'timestamp',
  Service = 'service',
  Environment = 'environment',
  Severity = 'severity',
  Message = 'message',
  TraceId = 'traceId',
  SpanId = 'spanId',
  Host = 'host',
  StatusCode = 'statusCode',
  DurationMs = 'durationMs',
  ErrorType = 'errorType',
  /** A numeric sample value — metrics queries. */
  Value = 'value',
}
