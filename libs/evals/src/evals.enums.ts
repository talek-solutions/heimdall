/** What the judge scores, 0 to 2 each (`.docs/design/replay-and-evals.md`, The rubric). */
export enum JudgeDimension {
  Component = 'component',
  Mechanism = 'mechanism',
  Evidence = 'evidence',
}

/** What code checks without a model. */
export enum EvalCheck {
  Outcome = 'outcome',
  Origin = 'origin',
  Cause = 'cause',
}

export enum CheckResult {
  Pass = 'pass',
  Fail = 'fail',
  /** The reference has no answer to check against, e.g. no origin for a no-signal case. */
  NotApplicable = 'n/a',
}

export enum EvalRunStatus {
  /** The investigation produced a report, whatever its outcome. */
  Completed = 'completed',
  /** It ended in an error; the checks fail and the judge is not asked. */
  Failed = 'failed',
}

export enum CalibrationStatus {
  /** A passing calibration exists for the judge model in use. */
  Calibrated = 'calibrated',
  /** None, a failed one, or one for another judge model: scores are not to be trusted. */
  Uncalibrated = 'uncalibrated',
}

export enum EvalEnvVariable {
  /** The judge's model; a calibration counts only for the model it was made with. */
  JudgeModel = 'EVAL_JUDGE_MODEL',
  GoldenDir = 'EVAL_GOLDEN_DIR',
  CalibrationDir = 'EVAL_CALIBRATION_DIR',
  /** Where scorecards and scoring sheets are written; `~/.heimdall/evals` by default. */
  OutputDir = 'EVAL_OUTPUT_DIR',
}
