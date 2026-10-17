import type { IAgentBudget } from '@heimdall/agent';

export interface ITriageConfig {
  readonly model: string;
  /** A top candidate below this is ambiguous. */
  readonly minConfidence: number;
  /** A runner-up within this of the top candidate is ambiguous. */
  readonly ambiguityMargin: number;
  readonly maxCandidates: number;
}

/** `.docs/design/health-evaluation.md`, Defaults. */
export interface IDeviationConfig {
  readonly z: number;
  readonly minRun: number;
  /** A fraction: 0.1 is 10%. */
  readonly minEffect: number;
}

/** `.docs/design/log-and-trace-evidence.md`, Sampling. */
export interface IEvidenceConfig {
  /** Log lines read per time slice, for the window and for the baseline. */
  readonly logSampleLimit: number;
  /** Traces read per time slice, for the window and for the baseline. */
  readonly traceSampleLimit: number;
}

export interface IExecutionConfig {
  readonly model: string;
  /** Only the limits whose INVESTIGATION_* variable is set; the rest stay the AGENT_* defaults. */
  readonly budget: Partial<IAgentBudget>;
  readonly stepFloorSeconds: number;
  readonly deviation: IDeviationConfig;
  readonly evidence: IEvidenceConfig;
}

export interface IInvestigationConfig {
  readonly lookbackMs: number;
  readonly hopBudget: number;
  readonly maxChecks: number;
  readonly triage: ITriageConfig;
  readonly execution: IExecutionConfig;
}

export interface IClock {
  now(): Date;
}
