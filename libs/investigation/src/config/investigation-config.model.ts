export interface ITriageConfig {
  readonly model: string;
  /** A top candidate below this is ambiguous. */
  readonly minConfidence: number;
  /** A runner-up within this of the top candidate is ambiguous. */
  readonly ambiguityMargin: number;
  readonly maxCandidates: number;
}

export interface IInvestigationConfig {
  readonly lookbackMs: number;
  readonly hopBudget: number;
  readonly maxChecks: number;
  readonly triage: ITriageConfig;
}

export interface IClock {
  now(): Date;
}
