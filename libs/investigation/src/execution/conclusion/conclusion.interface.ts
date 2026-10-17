import type { ConclusionOutcome, MitigationTier, ResultVerdict } from './conclusion.enums';

export interface IConclusionVerdict {
  readonly result: string;
  readonly verdict: ResultVerdict;
  readonly reason: string;
}

export interface IMitigation {
  readonly tier: MitigationTier;
  readonly action: string;
  readonly tradeoff: string;
}

/** The `conclude` tool's input; code checks it before the run may end (ADR 0018). */
export interface IConclusion {
  readonly outcome: ConclusionOutcome;
  /** Two or three sentences for the engineer. */
  readonly summary: string;
  readonly cause?: { readonly vertex: string; readonly mechanism: string } | undefined;
  readonly origin?: { readonly step: string; readonly uncertain: boolean } | undefined;
  readonly verdicts: readonly IConclusionVerdict[];
  /** Result ids the conclusion rests on. */
  readonly evidence: readonly string[];
  /** 0 to 1. */
  readonly confidence: number;
  readonly mitigations: readonly IMitigation[];
}
