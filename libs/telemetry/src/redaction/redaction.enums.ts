/** `.docs/design/redaction-and-scrubbers.md`, Observability. Counts only, never a value. */
export enum RedactionMetric {
  Records = 'heimdall.redaction.records',
  FieldsDropped = 'heimdall.redaction.fields_dropped',
  Matches = 'heimdall.redaction.matches',
}

export enum RedactionAttribute {
  Signal = 'heimdall.telemetry.signal',
  Component = 'heimdall.component',
  Scrubber = 'heimdall.redaction.scrubber',
  Records = 'heimdall.redaction.records',
  FieldsDropped = 'heimdall.redaction.fields_dropped',
  Matches = 'heimdall.redaction.matches',
  Truncated = 'heimdall.redaction.truncated',
}
