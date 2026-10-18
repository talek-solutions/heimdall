export enum ExitCode {
  Success = 0,
  Unexpected = 1,
  Usage = 2,
  NoSignal = 3,
  ProviderAuth = 4,
  BudgetExceeded = 5,
  /** `heimdall replay`: the replayed run did not reproduce the recorded one (ADR 0007). */
  ReplayDiverged = 6,
}
