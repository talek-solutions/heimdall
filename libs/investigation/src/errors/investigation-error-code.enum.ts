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
}
