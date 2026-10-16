import { Inject, Injectable } from '@nestjs/common';
import {
  InjectLlmProvider,
  InjectLlmToolPort,
  LLM_CONFIG,
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  LLMToolChoiceType,
  type ILLMMessage,
  type ILLMProvider,
  type ILLMToolCallPart,
  type ILLMToolDefinition,
  type ILLMToolPort,
  type ILlmConfig,
} from '@heimdall/llm';
import { AGENT_CLOCK, AGENT_CONFIG } from '../agent.tokens';
import type { IAgentClock, IAgentConfig } from '../config/agent-config.model';
import {
  AgentEventType,
  AgentOutcome,
  InconclusiveReason,
  ToolAccess,
  ToolResultStatus,
  type BudgetDimension,
} from '../enums';
import { AgentBudgetExceededError, AgentError, AgentErrorCode } from '../errors';
import { AgentRunTelemetry } from '../observability/agent-run.telemetry';
import type { IAgentTool, IToolContext, IToolResult } from '../tools/agent-tool.interface';
import { toolError } from '../tools/tool-results';
import { AgentBudget } from './agent-budget';
import type { IAgentEvent } from './agent-event.interface';
import type { IAgentRunRequest, IAgentRunResult, IAgentTranscript } from './agent-run.interface';
import { mapWithConcurrency } from './concurrency';

const DEFAULT_MAX_TOKENS = 16_000;
/** Paused turns resumed in a row before the run gives up. */
const MAX_CONTINUATIONS = 5;
const MAX_NUDGES = 1;

interface ICallOutcome {
  readonly call: ILLMToolCallPart;
  readonly result: IToolResult;
}

/**
 * The agent loop of ADR 0017: model call, tool calls, results, repeat, until the stop tool
 * succeeds or the run ends inconclusive. History is append-only, so the cached prefix holds.
 */
@Injectable()
export class AgentRunner {
  constructor(
    @InjectLlmProvider() private readonly llm: ILLMProvider,
    @InjectLlmToolPort() private readonly toolPort: ILLMToolPort,
    @Inject(LLM_CONFIG) private readonly llmConfig: ILlmConfig,
    @Inject(AGENT_CONFIG) private readonly config: IAgentConfig,
    @Inject(AGENT_CLOCK) private readonly clock: IAgentClock,
  ) {}

  async run<TOutput>(request: IAgentRunRequest<TOutput>): Promise<IAgentRunResult<TOutput>> {
    if (request.tools.get(request.stopTool.name) !== request.stopTool) {
      throw new AgentError(
        AgentErrorCode.StopToolMissing,
        `the stop tool '${request.stopTool.name}' is not among the run's tools (${request.tools.names.join(', ')})`,
      );
    }
    const loop = new AgentLoop(
      request,
      this.llm,
      this.toolPort.render(request.tools.specs()),
      this.toolPort.requestOptions(),
      new AgentBudget({ ...this.config.budget, ...request.budget }, this.clock),
      new AgentRunTelemetry(request.agent, request.model, this.llmConfig.preferredProvider),
      this.config.toolConcurrency,
      this.clock,
    );

    return loop.run();
  }
}

/** The state of one run. Every change to `messages` is an append. */
class AgentLoop<TOutput> {
  private readonly messages: ILLMMessage[];
  private nudges = 0;
  private continuations = 0;
  private finalTurnNoticed = false;

  constructor(
    private readonly request: IAgentRunRequest<TOutput>,
    private readonly llm: ILLMProvider,
    private readonly tools: readonly ILLMToolDefinition[],
    private readonly providerOptions: object,
    private readonly budget: AgentBudget,
    private readonly telemetry: AgentRunTelemetry,
    private readonly concurrency: number,
    private readonly clock: IAgentClock,
  ) {
    this.messages = [...request.messages];
  }

  async run(): Promise<IAgentRunResult<TOutput>> {
    try {
      return await this.loop();
    } catch (error) {
      this.telemetry.fail(error, this.budget.usage(), this.budget.fractions());
      throw error;
    }
  }

  private async loop(): Promise<IAgentRunResult<TOutput>> {
    for (;;) {
      this.assertWithinBudget(this.budget.exceededBeforeTurn());
      if (this.budget.isFinalTurn() && !this.finalTurnNoticed) {
        this.finalTurnNoticed = true;
        this.say(
          `This is your last turn within the budget. Call ${this.request.stopTool.name} now with what you have.`,
        );
      }
      const turn = this.budget.startTurn();
      this.emit({ type: AgentEventType.TurnStarted, turn });

      const response = await this.telemetry.chat(this.maxTokens, () =>
        this.llm.chat({
          model: this.request.model,
          system: this.request.system,
          messages: [...this.messages],
          tools: [...this.tools],
          // Current models reject a forced tool choice; the prompt and the nudge steer instead.
          toolChoice: { type: LLMToolChoiceType.AUTO },
          maxTokens: this.maxTokens,
          ...(this.request.reasoning === undefined ? {} : { reasoning: this.request.reasoning }),
          providerOptions: { ...this.providerOptions },
        }),
      );
      const calls = response.content.filter(
        (part): part is ILLMToolCallPart => part.type === LLMContentPartType.TOOL_CALL,
      );

      this.budget.recordModel(response.usage);
      this.emit({
        type: AgentEventType.ModelResponded,
        turn,
        finishReason: response.finishReason,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        toolCalls: calls.length,
      });
      // Reasoning parts go back unchanged: thinking-enabled tool loops require them.
      if (response.content.length > 0) {
        this.messages.push({ role: LLMMessageRole.ASSISTANT, content: response.content });
      }

      if (response.finishReason === LLMFinishReason.CONTENT_FILTER) {
        return this.inconclusive(InconclusiveReason.Refused);
      }
      if (response.finishReason === LLMFinishReason.LENGTH) {
        await this.recoverFromTruncation(turn, calls);
        continue;
      }
      if (calls.length > 0) {
        const stopped = await this.runCalls(turn, calls);

        if (stopped !== undefined) {
          return stopped;
        }
        continue;
      }
      if (response.finishReason === LLMFinishReason.PAUSED) {
        this.continuations += 1;
        if (this.continuations > MAX_CONTINUATIONS) {
          return this.inconclusive(InconclusiveReason.PauseLimit);
        }
        continue;
      }
      if (this.nudges >= MAX_NUDGES) {
        return this.inconclusive(InconclusiveReason.NoStopCall);
      }
      this.nudges += 1;
      this.say(
        `Continue with the tools. When you are done, call ${this.request.stopTool.name}; a reply without a tool call ends the run without a result.`,
      );
    }
  }

  /** Runs one reply's calls; returns the run's result when the stop tool succeeded. */
  private async runCalls(
    turn: number,
    calls: readonly ILLMToolCallPart[],
  ): Promise<IAgentRunResult<TOutput> | undefined> {
    const stopName = this.request.stopTool.name;
    const [stopCall, ...repeatedStops] = calls.filter((call) => call.name === stopName);

    this.assertWithinBudget(this.budget.exceededByToolCalls(calls.length));

    const outcomes = await mapWithConcurrency(
      calls.filter((call) => call.name !== stopName),
      this.concurrency,
      (call) => this.call(turn, call, () => this.execute(call)),
    );
    let output: { readonly value: TOutput } | undefined;

    if (stopCall !== undefined) {
      outcomes.push(
        await this.call(turn, stopCall, async () => {
          const parsed = this.request.stopTool.parse(stopCall.input);

          if (!parsed.ok) {
            return toolError(AgentErrorCode.InvalidToolInput, parsed.problem);
          }
          const result = await this.request.stopTool.execute(parsed.input, this.context(stopCall));

          if (result.status === ToolResultStatus.Ok) {
            output = { value: parsed.input };
          }
          return result;
        }),
      );
    }
    for (const repeated of repeatedStops) {
      outcomes.push(
        await this.call(turn, repeated, async () =>
          toolError(AgentErrorCode.RepeatedStopCall, `call ${stopName} once per reply`),
        ),
      );
    }
    this.answer(calls, outcomes);

    return output === undefined ? undefined : this.completed(output.value);
  }

  private async execute(call: ILLMToolCallPart): Promise<IToolResult> {
    const tool: IAgentTool | undefined = this.request.tools.get(call.name);

    if (tool === undefined) {
      return toolError(
        AgentErrorCode.UnknownTool,
        `no tool named '${call.name}'; the tools are ${this.request.tools.names.join(', ')}`,
      );
    }
    const parsed = tool.parse(call.input);

    if (!parsed.ok) {
      return toolError(AgentErrorCode.InvalidToolInput, parsed.problem);
    }
    if (tool.access === ToolAccess.Mutating && !(await this.confirmed(call, parsed.input))) {
      return toolError(
        AgentErrorCode.MutatingToolRefused,
        `'${call.name}' changes the system and was not confirmed; Heimdall runs read-only`,
      );
    }
    try {
      return await tool.execute(parsed.input, this.context(call));
    } catch (error) {
      return toolError(
        AgentErrorCode.ToolFailed,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Wraps one call in its span, its events and its budget charge. */
  private async call(
    turn: number,
    call: ILLMToolCallPart,
    execute: () => Promise<IToolResult>,
  ): Promise<ICallOutcome> {
    const startedAt = this.clock.now();

    this.emit({ type: AgentEventType.ToolCalled, turn, callId: call.id, tool: call.name });
    const result = await this.telemetry.tool(call.name, call.id, execute);
    const cost = result.cost ?? 0;

    this.budget.recordTool(cost);
    this.emit({
      type: AgentEventType.ToolCompleted,
      turn,
      callId: call.id,
      tool: call.name,
      status: result.status,
      summary: result.summary,
      cost,
      durationMs: this.clock.now() - startedAt,
    });
    return { call, result };
  }

  /**
   * A cut-off reply may hold incomplete tool calls. Each one is answered with an error rather
   * than run, so the history stays valid without editing it.
   */
  private async recoverFromTruncation(
    turn: number,
    calls: readonly ILLMToolCallPart[],
  ): Promise<void> {
    if (calls.length === 0) {
      this.say('Your reply was cut off at the output limit. Continue, more concisely.');
      return;
    }
    const outcomes: ICallOutcome[] = [];

    for (const call of calls) {
      outcomes.push(
        await this.call(turn, call, async () =>
          toolError(
            AgentErrorCode.OutputTruncated,
            'your reply was cut off at the output limit before this call was complete; call it again, more concisely',
          ),
        ),
      );
    }
    this.answer(calls, outcomes);
  }

  /** All results of one reply go back in one turn, in call order. */
  private answer(calls: readonly ILLMToolCallPart[], outcomes: readonly ICallOutcome[]): void {
    const byId = new Map(outcomes.map((outcome) => [outcome.call.id, outcome.result]));

    this.messages.push({
      role: LLMMessageRole.TOOL,
      content: calls.flatMap((call) => {
        const result = byId.get(call.id);
        return result === undefined
          ? []
          : [
              {
                type: LLMContentPartType.TOOL_RESULT,
                toolCallId: call.id,
                content: JSON.stringify(result.content),
                ...(result.status === ToolResultStatus.Error ? { isError: true } : {}),
              },
            ];
      }),
    });
  }

  private async confirmed(call: ILLMToolCallPart, input: unknown): Promise<boolean> {
    return this.request.confirm === undefined
      ? false
      : this.request.confirm({ tool: call.name, callId: call.id, input });
  }

  private context(call: ILLMToolCallPart): IToolContext {
    return { callId: call.id, signal: AbortSignal.timeout(Math.max(1, this.budget.remainingMs())) };
  }

  private say(text: string): void {
    this.messages.push({
      role: LLMMessageRole.USER,
      content: [{ type: LLMContentPartType.TEXT, text }],
    });
  }

  private assertWithinBudget(exceeded: BudgetDimension | undefined): void {
    if (exceeded !== undefined) {
      throw new AgentBudgetExceededError(exceeded, this.budget.usage(), this.transcript());
    }
  }

  private completed(output: TOutput): IAgentRunResult<TOutput> {
    const usage = this.budget.usage();

    this.telemetry.finish(AgentOutcome.Completed, undefined, usage, this.budget.fractions());
    this.emit({ type: AgentEventType.Finished, outcome: AgentOutcome.Completed, usage });
    return {
      outcome: AgentOutcome.Completed,
      output,
      usage,
      transcript: this.transcript(),
      ...this.trace(),
    };
  }

  private inconclusive(reason: InconclusiveReason): IAgentRunResult<TOutput> {
    const usage = this.budget.usage();

    this.telemetry.finish(AgentOutcome.Inconclusive, reason, usage, this.budget.fractions());
    this.emit({ type: AgentEventType.Finished, outcome: AgentOutcome.Inconclusive, reason, usage });
    return {
      outcome: AgentOutcome.Inconclusive,
      reason,
      usage,
      transcript: this.transcript(),
      ...this.trace(),
    };
  }

  private trace(): { traceId?: string } {
    const { traceId } = this.telemetry;
    return traceId === undefined ? {} : { traceId };
  }

  private transcript(): IAgentTranscript {
    return { system: this.request.system, messages: [...this.messages] };
  }

  private emit(event: IAgentEvent): void {
    this.request.onEvent?.(event);
  }

  private get maxTokens(): number {
    return this.request.maxTokens ?? DEFAULT_MAX_TOKENS;
  }
}
