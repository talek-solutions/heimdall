/** The report's JSON contract (`.docs/schema/investigation-report.md`); bumped on a breaking change. */
export enum ReportSchemaVersion {
  V1 = 1,
}

/** Which part of the conclusion a blind spot sits under. */
export enum BlindSpotTouch {
  Cause = 'cause',
  Origin = 'origin',
  /** The subject of a result the conclusion cites. */
  Evidence = 'evidence',
}

/** Whether the run looked at what else is hurt. */
export enum ImpactStatus {
  /** The scope has no impact flows. */
  NotPlanned = 'not-planned',
  /** Impact checks were planned, and none ran. */
  NotRun = 'not-run',
  /** At least one impact check ran. */
  Checked = 'checked',
}
