import type { LLMFinishReason } from '@heimdall/llm';
import type { AgentEventType, AgentOutcome, InconclusiveReason, ToolResultStatus } from '../enums';
import type { IAgentUsage } from './agent-run.interface';

export interface IAgentTurnStarted {
  readonly type: AgentEventType.TurnStarted;
  readonly turn: number;
}

export interface IAgentModelResponded {
  readonly type: AgentEventType.ModelResponded;
  readonly turn: number;
  readonly finishReason: LLMFinishReason;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
}

export interface IAgentToolCalled {
  readonly type: AgentEventType.ToolCalled;
  readonly turn: number;
  readonly callId: string;
  readonly tool: string;
}

export interface IAgentToolCompleted {
  readonly type: AgentEventType.ToolCompleted;
  readonly turn: number;
  readonly callId: string;
  readonly tool: string;
  readonly status: ToolResultStatus;
  readonly summary: string;
  readonly cost: number;
  readonly durationMs: number;
}

export interface IAgentFinished {
  readonly type: AgentEventType.Finished;
  readonly outcome: AgentOutcome;
  readonly reason?: InconclusiveReason;
  readonly usage: IAgentUsage;
}

export type IAgentEvent =
  | IAgentTurnStarted
  | IAgentModelResponded
  | IAgentToolCalled
  | IAgentToolCompleted
  | IAgentFinished;
