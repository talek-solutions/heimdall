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
  /** The environment's context has no metrics source Heimdall can query. */
  SourceMissing = 'INVESTIGATION_SOURCE_MISSING',
  /** The context's metrics source is of a kind execution cannot query yet, e.g. Grafana-proxied. */
  SourceUnsupported = 'INVESTIGATION_SOURCE_UNSUPPORTED',
  /** The agent's conclusion stayed invalid after one correction. */
  ConclusionInvalid = 'INVESTIGATION_CONCLUSION_INVALID',
  // The codes below are results returned to the agent, never thrown.
  UnknownCheck = 'INVESTIGATION_UNKNOWN_CHECK',
  UnknownVertex = 'INVESTIGATION_UNKNOWN_VERTEX',
  OutOfReach = 'INVESTIGATION_OUT_OF_REACH',
  /** Logs and traces checks arrive with story 0018-02. */
  CheckUnavailable = 'INVESTIGATION_CHECK_UNAVAILABLE',
  NoQueryTemplate = 'INVESTIGATION_NO_QUERY_TEMPLATE',
  /** The metric's owner declares no metrics matchers, so its series cannot be told apart. */
  NoMetricsIdentity = 'INVESTIGATION_NO_METRICS_IDENTITY',
  QueryFailed = 'INVESTIGATION_QUERY_FAILED',
}
