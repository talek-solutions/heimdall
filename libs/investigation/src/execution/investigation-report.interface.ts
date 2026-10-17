import type { IAgentUsage, InconclusiveReason } from '@heimdall/agent';
import type { IInvestigationPlan } from '../interfaces/investigation-plan.interface';
import type { ICheckResult } from './checks/check-result.interface';
import type { ConclusionOutcome } from './conclusion/conclusion.enums';
import type { IConclusion } from './conclusion/conclusion.interface';
import type { IEvidenceRedaction } from './evidence/evidence-result.interface';
import type { IDroppedFields, IReachedPruned } from './execution.session';

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

/** What an execution produced; the final `--json` output and the `concluded` event. */
export interface IInvestigationReport {
  readonly plan: IInvestigationPlan;
  readonly outcome: ConclusionOutcome;
  /** Absent when the agent ended without a conclusion. */
  readonly conclusion: IConclusion | undefined;
  /** Why the agent ended without a conclusion. */
  readonly agentReason?: InconclusiveReason | undefined;
  readonly results: readonly ICheckResult[];
  readonly redaction: IReportRedaction;
  /** Pruned vertices the agent looked at anyway, and why. */
  readonly reachedPruned: readonly IReachedPruned[];
  readonly usage: IAgentUsage;
  /** Present when tracing is on. */
  readonly traceId?: string | undefined;
}
