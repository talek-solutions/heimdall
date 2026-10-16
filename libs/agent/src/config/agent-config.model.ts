export interface IAgentBudget {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxToolCost: number;
  readonly timeoutMs: number;
}

export interface IAgentConfig {
  readonly budget: IAgentBudget;
  /** Tool calls of one reply that run at the same time. */
  readonly toolConcurrency: number;
}

export interface IAgentClock {
  /** Milliseconds; only differences are used. */
  now(): number;
}
