import type { ILLMUsage } from '@heimdall/llm';
import type { IAgentBudget, IAgentClock } from '../config/agent-config.model';
import { BudgetDimension } from '../enums';
import type { IAgentUsage } from './agent-run.interface';

/** Tracks one run against its limits; `exceeded` names the first limit crossed. */
export class AgentBudget {
  private turns = 0;
  private toolCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedInputTokens = 0;
  private toolCost = 0;
  private readonly startedAt: number;

  constructor(
    readonly limits: IAgentBudget,
    private readonly clock: IAgentClock,
  ) {
    this.startedAt = clock.now();
  }

  /** Before a model call. */
  exceededBeforeTurn(): BudgetDimension | undefined {
    if (this.remainingMs() <= 0) {
      return BudgetDimension.Time;
    }
    if (this.turns >= this.limits.maxTurns) {
      return BudgetDimension.Turns;
    }
    if (this.inputTokens >= this.limits.maxInputTokens) {
      return BudgetDimension.InputTokens;
    }
    if (this.outputTokens >= this.limits.maxOutputTokens) {
      return BudgetDimension.OutputTokens;
    }
    if (this.toolCost >= this.limits.maxToolCost) {
      return BudgetDimension.ToolCost;
    }
    return undefined;
  }

  /** Before running `calls` tool calls of one reply. */
  exceededByToolCalls(calls: number): BudgetDimension | undefined {
    if (this.remainingMs() <= 0) {
      return BudgetDimension.Time;
    }
    return this.toolCalls + calls > this.limits.maxToolCalls
      ? BudgetDimension.ToolCalls
      : undefined;
  }

  /** The turn about to start is the last one any limit allows. */
  isFinalTurn(): boolean {
    return this.turns + 1 >= this.limits.maxTurns;
  }

  startTurn(): number {
    this.turns += 1;
    return this.turns;
  }

  recordModel(usage: ILLMUsage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.cachedInputTokens += usage.cachedInputTokens ?? 0;
  }

  recordTool(cost: number): void {
    this.toolCalls += 1;
    this.toolCost += cost;
  }

  remainingMs(): number {
    return this.limits.timeoutMs - (this.clock.now() - this.startedAt);
  }

  usage(): IAgentUsage {
    return {
      turns: this.turns,
      toolCalls: this.toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedInputTokens: this.cachedInputTokens,
      toolCost: this.toolCost,
      elapsedMs: this.clock.now() - this.startedAt,
    };
  }

  /** Used ÷ limit per dimension, for the budget metric. */
  fractions(): ReadonlyMap<BudgetDimension, number> {
    const { limits } = this;
    const elapsed = this.clock.now() - this.startedAt;

    return new Map([
      [BudgetDimension.Turns, this.turns / limits.maxTurns],
      [BudgetDimension.ToolCalls, this.toolCalls / limits.maxToolCalls],
      [BudgetDimension.InputTokens, this.inputTokens / limits.maxInputTokens],
      [BudgetDimension.OutputTokens, this.outputTokens / limits.maxOutputTokens],
      [BudgetDimension.ToolCost, this.toolCost / limits.maxToolCost],
      [BudgetDimension.Time, elapsed / limits.timeoutMs],
    ]);
  }
}
