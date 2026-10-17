import type { ExpectationKind, IndicatorRole } from '@heimdall/core/manifest';
import type { InvestigationErrorCode } from '../../errors';
import type {
  ILogsResult,
  ITraceResult,
  ITracesResult,
} from '../evidence/evidence-result.interface';
import type {
  DeviationDirection,
  ObjectiveVerdict,
  PreliminarySignal,
} from '../health/health.enums';
import type { ResultKind } from './result-kind.enum';

export interface ICheckProblem {
  readonly errorCode: InvestigationErrorCode;
  readonly message: string;
}

/**
 * One role of one indicator over one window, as the agent receives it
 * (`.docs/design/health-evaluation.md`, What the agent receives). No query text, no matchers.
 */
export interface IRoleResult {
  /** `r1`, `r2`, …: what a conclusion cites. */
  readonly result: string;
  readonly kind: ResultKind.Indicator;
  /** The planned check, when the result answers one. */
  readonly check: string | null;
  readonly indicator: string;
  readonly subject: string;
  readonly role: IndicatorRole;
  readonly expectation: ExpectationKind;
  /** Code's verdict for objective expectations; `null` for `baseline`, which is the agent's. */
  readonly verdict: ObjectiveVerdict | null;
  readonly bounds: string | null;
  readonly signal: PreliminarySignal;
  readonly direction: DeviationDirection | null;
  readonly unit: string;
  readonly window: { readonly start: string; readonly end: string; readonly stepSeconds: number };
  readonly baseline: { readonly median: number; readonly spread: number } | null;
  readonly peak: {
    readonly value: number;
    readonly at: string;
    readonly z: number;
    /** `null` when the baseline median is 0 and the change has no finite size. */
    readonly effectPercent: number | null;
  } | null;
  readonly longestRun: number;
  readonly onset: string | null;
  readonly breachOnset: string | null;
  readonly coverage: number;
  /** A narrower window worth re-running the check over. */
  readonly zoom: { readonly start: string; readonly end: string } | null;
  /** Why no statistics could be computed. */
  readonly problem: ICheckProblem | null;
}

/** Every result a tool can return; evidence (logs, traces, a trace) carries no verdict. */
export type ICheckResult = IRoleResult | ILogsResult | ITracesResult | ITraceResult;
export type IEvidenceResult = ILogsResult | ITracesResult | ITraceResult;
