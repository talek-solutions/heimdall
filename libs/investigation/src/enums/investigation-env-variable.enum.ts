export enum InvestigationEnvVariable {
  /** Model for the classification call; defaults to ADR 0004's model. */
  TriageModel = 'INVESTIGATION_TRIAGE_MODEL',
  /** Default window when `--since` is not given, e.g. `60m`. */
  Lookback = 'INVESTIGATION_LOOKBACK',
  /** Hops beyond the path that neighbours and contention may reach. */
  HopBudget = 'INVESTIGATION_HOP_BUDGET',
  MaxChecks = 'INVESTIGATION_MAX_CHECKS',
}
