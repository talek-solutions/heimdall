export enum TelemetrySpanAttribute {
  Backend = 'heimdall.telemetry.backend',
  Signal = 'heimdall.telemetry.signal',
  /** The OpenTelemetry database convention for a query's text. */
  QueryText = 'db.query.text',
  Series = 'heimdall.telemetry.series',
  Points = 'heimdall.telemetry.points',
  Records = 'heimdall.telemetry.records',
  ErrorType = 'error.type',
}

export enum TelemetrySignal {
  Metrics = 'metrics',
  Logs = 'logs',
  Traces = 'traces',
}

export enum TelemetrySpanName {
  Query = 'telemetry.query',
  Redact = 'telemetry.redact',
}
