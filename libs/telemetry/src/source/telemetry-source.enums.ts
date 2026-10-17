export enum TelemetrySpanAttribute {
  Backend = 'heimdall.telemetry.backend',
  Signal = 'heimdall.telemetry.signal',
  /** The OpenTelemetry database convention for a query's text. */
  QueryText = 'db.query.text',
  Series = 'heimdall.telemetry.series',
  Points = 'heimdall.telemetry.points',
  ErrorType = 'error.type',
}

export enum TelemetrySignal {
  Metrics = 'metrics',
}
