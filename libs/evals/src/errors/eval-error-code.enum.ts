/** `EVAL_`-prefixed so the CLI can group codes by string value without collisions. */
export enum EvalErrorCode {
  /** A golden case or a scoring sheet does not parse or misses a field; the message names it. */
  CaseInvalid = 'EVAL_CASE_INVALID',
  /** `--case` names no golden case. */
  CaseNotFound = 'EVAL_CASE_NOT_FOUND',
  /** Fewer hand-scored sheets than calibration needs. */
  CalibrationTooSmall = 'EVAL_CALIBRATION_TOO_SMALL',
  // The codes below are recorded on a run in the scorecard, never thrown.
  /** The judge ended without a valid score. */
  JudgeFailed = 'EVAL_JUDGE_FAILED',
  /** The investigation child wrote no report. */
  RunFailed = 'EVAL_RUN_FAILED',
}
