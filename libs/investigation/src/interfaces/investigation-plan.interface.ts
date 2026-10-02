import type { IndicatorRole } from '@heimdall/core/manifest';
import type { IIndicatorVertex, ISemanticSelector, VertexType } from '@heimdall/core/graph';
import type {
  BlindSpotReason,
  CheckKind,
  CheckTier,
  EntryMethod,
  PruneReason,
  ScopeReason,
  SymptomMethod,
} from '../enums';

export interface ITimeWindow {
  readonly start: Date;
  readonly end: Date;
}

export interface IInvestigationWindow extends ITimeWindow {
  /** The preceding window of the same length, which "healthy" is compared against. */
  readonly baseline: ITimeWindow;
}

export interface IPlanEnvironment {
  readonly name: string;
  /** The `~/.heimdall/config.yaml` context whose sources the checks will query. */
  readonly context: string;
}

export interface ISymptom {
  /** Which signal kinds would show the problem. Every role when unclassified. */
  readonly roles: readonly IndicatorRole[];
  readonly method: SymptomMethod;
}

export interface IEntryCandidate {
  readonly vertex: string;
  /** 0 to 1, as the model judged it. */
  readonly confidence: number;
  readonly reason: string;
}

export interface IInvestigationEntry {
  readonly vertex: string;
  readonly type: VertexType;
  readonly method: EntryMethod;
  readonly confidence?: number | undefined;
  readonly reason?: string | undefined;
  /** Everything the model proposed, best first; empty when no model ran. */
  readonly candidates: readonly IEntryCandidate[];
}

export interface IScopedVertex {
  readonly vertex: string;
  readonly reason: ScopeReason;
}

export interface IPrunedVertex {
  readonly vertex: string;
  readonly reason: PruneReason;
}

export interface IInvestigationScope {
  /** Flows that can cause the symptom, walked step by step. */
  readonly suspectFlows: readonly string[];
  /** Flows the fault can reach but not originate from; reported as impact. */
  readonly impactFlows: readonly string[];
  readonly vertices: readonly IScopedVertex[];
  readonly pruned: readonly IPrunedVertex[];
}

export interface ICheckCondition {
  /**
   * Run only if one of these steps is where the fault starts: the deepest unhealthy hop of a
   * sync flow, or the first unhealthy stage of an async one (ADR 0016).
   */
  readonly failingSteps: readonly string[];
}

export interface ICheck {
  /** `c1`, `c2`, … in the order checks run. */
  readonly id: string;
  readonly tier: CheckTier;
  readonly kind: CheckKind;
  /** The vertex the check looks at. */
  readonly subject: string;
  readonly indicator?: IIndicatorVertex | undefined;
  /** The indicator's roles that matter for this symptom; empty for logs and traces. */
  readonly roles: readonly IndicatorRole[];
  /** Narrows logs and traces to the step, by label meaning. */
  readonly match?: ISemanticSelector | undefined;
  /** Joins logs across a hop that drops trace context. */
  readonly correlationKey?: string | undefined;
  readonly when?: ICheckCondition | undefined;
  readonly rationale: string;
}

export interface IBlindSpot {
  readonly vertex: string;
  readonly reason: BlindSpotReason;
}

export interface IInvestigationPlan {
  readonly query: string;
  readonly system: string;
  readonly environment: IPlanEnvironment | undefined;
  readonly window: IInvestigationWindow;
  readonly symptom: ISymptom;
  readonly entry: IInvestigationEntry;
  readonly scope: IInvestigationScope;
  readonly checks: readonly ICheck[];
  readonly blindSpots: readonly IBlindSpot[];
  /** Checks dropped by the check cap, from the end of the plan. */
  readonly omittedChecks: number;
}
