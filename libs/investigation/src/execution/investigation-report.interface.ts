import type { IAgentUsage, InconclusiveReason } from '@heimdall/agent';
import type { IInvestigationPlan } from '../interfaces/investigation-plan.interface';
import type { IRoleResult } from './checks/check-result.interface';
import type { ConclusionOutcome } from './conclusion/conclusion.enums';
import type { IConclusion } from './conclusion/conclusion.interface';
import type { IReachedPruned } from './execution.session';

/** What an execution produced; the final `--json` output and the `concluded` event. */
export interface IInvestigationReport {
  readonly plan: IInvestigationPlan;
  readonly outcome: ConclusionOutcome;
  /** Absent when the agent ended without a conclusion. */
  readonly conclusion: IConclusion | undefined;
  /** Why the agent ended without a conclusion. */
  readonly agentReason?: InconclusiveReason | undefined;
  readonly results: readonly IRoleResult[];
  /** Pruned vertices the agent looked at anyway, and why. */
  readonly reachedPruned: readonly IReachedPruned[];
  readonly usage: IAgentUsage;
  /** Present when tracing is on. */
  readonly traceId?: string | undefined;
}
