export enum InvestigationEnvVariable {
  /** Model for the classification call; defaults to ADR 0004's model. */
  TriageModel = 'INVESTIGATION_TRIAGE_MODEL',
  /** Default window when `--since` is not given, e.g. `60m`. */
  Lookback = 'INVESTIGATION_LOOKBACK',
  /** Hops beyond the path that neighbours and contention may reach. */
  HopBudget = 'INVESTIGATION_HOP_BUDGET',
  MaxChecks = 'INVESTIGATION_MAX_CHECKS',
  /** Model for the execution agent (ADR 0018). */
  AgentModel = 'INVESTIGATION_AGENT_MODEL',
  // Override the AGENT_* defaults for investigation runs, only when set.
  MaxTurns = 'INVESTIGATION_MAX_TURNS',
  /** Backend queries; a metrics check costs two per role, a logs or traces check up to 11. */
  MaxQueries = 'INVESTIGATION_MAX_QUERIES',
  TimeoutSeconds = 'INVESTIGATION_TIMEOUT_SECONDS',
  // Health evaluation (.docs/design/health-evaluation.md).
  DeviationZ = 'INVESTIGATION_DEVIATION_Z',
  DeviationMinRun = 'INVESTIGATION_DEVIATION_MIN_RUN',
  DeviationMinEffectPercent = 'INVESTIGATION_DEVIATION_MIN_EFFECT_PERCENT',
  StepFloorSeconds = 'INVESTIGATION_STEP_FLOOR_SECONDS',
  // Evidence sampling (.docs/design/log-and-trace-evidence.md).
  /** Log lines per time slice. */
  LogSampleLimit = 'INVESTIGATION_LOG_SAMPLE_LIMIT',
  /** Traces per time slice. */
  TraceSampleLimit = 'INVESTIGATION_TRACE_SAMPLE_LIMIT',
}
