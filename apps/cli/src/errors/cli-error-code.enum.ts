export enum CliErrorCode {
  ConflictingOutputFormats = 'CONFLICTING_OUTPUT_FORMATS',
  ConflictingVerbosity = 'CONFLICTING_VERBOSITY',
  InvalidEnvironmentValue = 'INVALID_ENVIRONMENT_VALUE',
  PromptRequiredWithoutTty = 'PROMPT_REQUIRED_WITHOUT_TTY',
  /** A flag's value cannot be used, e.g. `--repeat 0`. */
  InvalidFlagValue = 'INVALID_FLAG_VALUE',
}
