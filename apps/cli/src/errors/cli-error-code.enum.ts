export enum CliErrorCode {
  ConflictingOutputFormats = 'CONFLICTING_OUTPUT_FORMATS',
  ConflictingVerbosity = 'CONFLICTING_VERBOSITY',
  InvalidEnvironmentValue = 'INVALID_ENVIRONMENT_VALUE',
  PromptRequiredWithoutTty = 'PROMPT_REQUIRED_WITHOUT_TTY',
  /** A flag's value cannot be used, e.g. `--repeat 0`. */
  InvalidFlagValue = 'INVALID_FLAG_VALUE',
  /** `heimdall report`: the run ended without a report, under `--plan-only` or in an error. */
  ReportNotRecorded = 'REPORT_NOT_RECORDED',
  /** `heimdall report`: the run was recorded by a build whose report predates schema version 1. */
  ReportOutdated = 'REPORT_OUTDATED',
}
