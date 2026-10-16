/** `AGENT_`-prefixed so the CLI can group codes by string value without collisions. */
export enum AgentErrorCode {
  /** An `AGENT_*` variable has a value that cannot be used. */
  InvalidConfig = 'AGENT_INVALID_CONFIG',
  /** A run crossed one of its limits; exit code 5 (ADR 0006). */
  BudgetExceeded = 'AGENT_BUDGET_EXCEEDED',
  DuplicateTool = 'AGENT_DUPLICATE_TOOL',
  /** The stop tool is not in the run's repository. */
  StopToolMissing = 'AGENT_STOP_TOOL_MISSING',
  // The codes below are tool results returned to the model, never thrown.
  UnknownTool = 'AGENT_UNKNOWN_TOOL',
  InvalidToolInput = 'AGENT_INVALID_TOOL_INPUT',
  ToolFailed = 'AGENT_TOOL_FAILED',
  MutatingToolRefused = 'AGENT_MUTATING_TOOL_REFUSED',
  /** The reply was cut off at the output limit, so its tool calls may be incomplete. */
  OutputTruncated = 'AGENT_OUTPUT_TRUNCATED',
  /** More than one stop call in one reply; only the first is considered. */
  RepeatedStopCall = 'AGENT_REPEATED_STOP_CALL',
}
