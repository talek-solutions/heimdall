import type { LLMFinishReason } from '@heimdall/llm';
import type { InvestigationEventType } from '../enums';
import type { ICheckResult } from '../execution/checks/check-result.interface';
import type { IInvestigationReport } from '../execution/investigation-report.interface';
import type {
  IInvestigationEntry,
  IInvestigationPlan,
  IInvestigationScope,
  IInvestigationWindow,
  IPlanEnvironment,
  ISymptom,
} from './investigation-plan.interface';

export interface IInvestigationStartedEvent {
  readonly type: InvestigationEventType.Started;
  readonly query: string;
  readonly system: string;
  readonly environment: IPlanEnvironment | undefined;
  readonly window: IInvestigationWindow;
}

export interface ISymptomClassifiedEvent {
  readonly type: InvestigationEventType.SymptomClassified;
  readonly symptom: ISymptom;
}

export interface IEntryLocatedEvent {
  readonly type: InvestigationEventType.EntryLocated;
  readonly entry: IInvestigationEntry;
}

export interface IScopeResolvedEvent {
  readonly type: InvestigationEventType.ScopeResolved;
  readonly scope: IInvestigationScope;
}

export interface IPlanReadyEvent {
  readonly type: InvestigationEventType.PlanReady;
  readonly plan: IInvestigationPlan;
}

export interface IAgentTurnEvent {
  readonly type: InvestigationEventType.AgentTurn;
  readonly turn: number;
  readonly finishReason: LLMFinishReason;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ICheckCompletedEvent {
  readonly type: InvestigationEventType.CheckCompleted;
  readonly result: ICheckResult;
}

export interface IConcludedEvent {
  readonly type: InvestigationEventType.Concluded;
  readonly report: IInvestigationReport;
}

/** What the engine reports as it goes; renderers subscribe, the engine never prints (ADR 0006). */
export type IInvestigationEvent =
  | IInvestigationStartedEvent
  | ISymptomClassifiedEvent
  | IEntryLocatedEvent
  | IScopeResolvedEvent
  | IPlanReadyEvent
  | IAgentTurnEvent
  | ICheckCompletedEvent
  | IConcludedEvent;
