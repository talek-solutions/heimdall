import type { IAgentUsage, InconclusiveReason } from '@heimdall/agent';
import type { IBlindSpot, IInvestigationPlan } from '../interfaces/investigation-plan.interface';
import type { ICheckResult } from './checks/check-result.interface';
import type { ConclusionOutcome, ResultVerdict } from './conclusion/conclusion.enums';
import type { IConclusion } from './conclusion/conclusion.interface';
import type { IEvidenceRedaction } from './evidence/evidence-result.interface';
import type { IDroppedFields, IReachedPruned } from './execution.session';
import type { IProfile } from './health/profile.summariser';
import type { BlindSpotTouch, ImpactStatus, ReportSchemaVersion } from './report/report.enums';

/** What redaction did over the run. */
export interface IReportRedaction {
  /** The counts the agent saw, summed. */
  readonly totals: IEvidenceRedaction;
  /**
   * Names of the fields the allowlist dropped, per subject: in this local report only, so whoever
   * tunes the manifest can see what never left (ADR 0008). Never sent to the model or exported.
   */
  readonly droppedFields: readonly IDroppedFields[];
}

/** A blind spot of the plan that the conclusion leans on. */
export interface IReportBlindSpot extends IBlindSpot {
  readonly touches: BlindSpotTouch;
}

export interface IReportImpactSubject {
  readonly vertex: string;
  /** The worst verdict of its results; `null` when its checks did not run. */
  readonly verdict: ResultVerdict | null;
  readonly results: readonly string[];
}

/** What else is hurt: reported, never a cause. */
export interface IReportImpact {
  readonly status: ImpactStatus;
  readonly subjects: readonly IReportImpactSubject[];
}

/** What an execution produced; the final `--json` output and the `concluded` event. */
export interface IInvestigationReport {
  readonly schemaVersion: ReportSchemaVersion;
  readonly outcome: ConclusionOutcome;
  /** Absent when the agent ended without a conclusion. */
  readonly conclusion: IConclusion | undefined;
  /** Why the agent ended without a conclusion. */
  readonly agentReason?: InconclusiveReason | undefined;
  /** Result ids worth reading first: the symptom, the origin, the cause, breached objectives. */
  readonly keyFigures: readonly string[];
  readonly blindSpots: readonly IReportBlindSpot[];
  readonly impact: IReportImpact;
  readonly plan: IInvestigationPlan;
  /** Exactly what the agent saw. */
  readonly results: readonly ICheckResult[];
  /** The window of each indicator result in a few points, by result id; the agent never saw them. */
  readonly profiles: Readonly<Record<string, IProfile>>;
  readonly redaction: IReportRedaction;
  /** Pruned vertices the agent looked at anyway, and why. */
  readonly reachedPruned: readonly IReachedPruned[];
  readonly usage: IAgentUsage;
  /** Present when tracing is on. */
  readonly traceId?: string | undefined;
}
