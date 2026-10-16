/** Defaults for every agent run; a caller may override them per run (ADR 0017). */
export enum AgentEnvVariable {
  MaxTurns = 'AGENT_MAX_TURNS',
  MaxToolCalls = 'AGENT_MAX_TOOL_CALLS',
  /** Summed over every model call, so it grows with the resent history. */
  MaxInputTokens = 'AGENT_MAX_INPUT_TOKENS',
  MaxOutputTokens = 'AGENT_MAX_OUTPUT_TOKENS',
  MaxToolCost = 'AGENT_MAX_TOOL_COST',
  TimeoutSeconds = 'AGENT_TIMEOUT_SECONDS',
  ToolConcurrency = 'AGENT_TOOL_CONCURRENCY',
}
