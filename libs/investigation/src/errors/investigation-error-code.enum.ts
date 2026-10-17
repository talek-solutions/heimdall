/** `INVESTIGATION_`-prefixed so the CLI can group codes by string value without collisions. */
export enum InvestigationErrorCode {
  /** An `INVESTIGATION_*` variable has a value that cannot be used. */
  InvalidConfig = 'INVESTIGATION_INVALID_CONFIG',
  EmptyQuery = 'INVESTIGATION_EMPTY_QUERY',
  /** The requested window is not a duration such as `30m`. */
  InvalidWindow = 'INVESTIGATION_INVALID_WINDOW',
  /** The environment is not in the manifest, or none was named and the manifest has several. */
  EnvironmentUnknown = 'INVESTIGATION_ENVIRONMENT_UNKNOWN',
  /** The named entry is not a vertex, or the model found nothing that fits. */
  EntryNotFound = 'INVESTIGATION_ENTRY_NOT_FOUND',
  /** Several candidates fit about equally and nobody chose among them. */
  EntryAmbiguous = 'INVESTIGATION_ENTRY_AMBIGUOUS',
  /** The classification answer stayed invalid after a retry. */
  TriageFailed = 'INVESTIGATION_TRIAGE_FAILED',
  /**
   * The environment's context has no source Heimdall can query: thrown for metrics, returned to the
   * agent for a logs or traces check.
   */
  SourceMissing = 'INVESTIGATION_SOURCE_MISSING',
  /** The context's source is of a kind execution cannot query yet, e.g. Grafana-proxied. */
  SourceUnsupported = 'INVESTIGATION_SOURCE_UNSUPPORTED',
  /** The agent's conclusion stayed invalid after one correction. */
  ConclusionInvalid = 'INVESTIGATION_CONCLUSION_INVALID',
  // The codes below are results returned to the agent, never thrown.
  UnknownCheck = 'INVESTIGATION_UNKNOWN_CHECK',
  UnknownVertex = 'INVESTIGATION_UNKNOWN_VERTEX',
  OutOfReach = 'INVESTIGATION_OUT_OF_REACH',
  NoQueryTemplate = 'INVESTIGATION_NO_QUERY_TEMPLATE',
  /** The metric's owner declares no metrics matchers, so its series cannot be told apart. */
  NoMetricsIdentity = 'INVESTIGATION_NO_METRICS_IDENTITY',
  QueryFailed = 'INVESTIGATION_QUERY_FAILED',
  /** The component declares no `telemetry.logs`. */
  NoLogsIdentity = 'INVESTIGATION_NO_LOGS_IDENTITY',
  /** The component declares no `telemetry.traces`. */
  NoTracesIdentity = 'INVESTIGATION_NO_TRACES_IDENTITY',
  /** `get_trace` asked for a trace the backend does not have. */
  TraceNotFound = 'INVESTIGATION_TRACE_NOT_FOUND',
}
