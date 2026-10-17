import type { ILLMMessage, ILLMReasoningConfig } from '@heimdall/llm';
import type { IAgentBudget } from '../config/agent-config.model';
import type { AgentOutcome, InconclusiveReason } from '../enums';
import type { IAgentTool } from '../tools/agent-tool.interface';
import type { ToolRepository } from '../tools/tool.repository';
import type { IAgentEvent } from './agent-event.interface';

export interface IToolConfirmation {
  readonly tool: string;
  readonly callId: string;
  readonly input: unknown;
}

export interface IAgentRunRequest<TOutput> {
  /** Names the run in traces and events, e.g. `heimdall.investigation`. */
  readonly agent: string;
  readonly model: string;
  readonly system: string;
  /** The opening history; the runner only ever appends to it. */
  readonly messages: readonly ILLMMessage[];
  readonly tools: ToolRepository;
  /** Must be in `tools`. When it succeeds, its parsed input is the run's output. */
  readonly stopTool: IAgentTool<TOutput>;
  /** Overrides the `AGENT_*` defaults for this run. */
  readonly budget?: Partial<IAgentBudget>;
  /** Per model call. */
  readonly maxTokens?: number;
  readonly reasoning?: ILLMReasoningConfig;
  /** Let the provider re-run a declined turn on a fallback model, where the model supports it. */
  readonly fallbackOnRefusal?: boolean;
  /** Without it, a mutating tool is refused (ADR 0002). */
  readonly confirm?: (call: IToolConfirmation) => Promise<boolean>;
  readonly onEvent?: (event: IAgentEvent) => void;
}

export interface IAgentUsage {
  readonly turns: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly toolCost: number;
  readonly elapsedMs: number;
}

export interface IAgentTranscript {
  readonly system: string;
  readonly messages: readonly ILLMMessage[];
}

interface IAgentRunBase {
  readonly usage: IAgentUsage;
  readonly transcript: IAgentTranscript;
  /** Present when tracing is on, so a report can link to the run's trace. */
  readonly traceId?: string;
}

export interface IAgentCompleted<TOutput> extends IAgentRunBase {
  readonly outcome: AgentOutcome.Completed;
  readonly output: TOutput;
}

export interface IAgentInconclusive extends IAgentRunBase {
  readonly outcome: AgentOutcome.Inconclusive;
  readonly reason: InconclusiveReason;
}

export type IAgentRunResult<TOutput> = IAgentCompleted<TOutput> | IAgentInconclusive;
