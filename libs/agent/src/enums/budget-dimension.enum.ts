export enum BudgetDimension {
  Turns = 'turns',
  ToolCalls = 'tool_calls',
  InputTokens = 'input_tokens',
  OutputTokens = 'output_tokens',
  /** Units a tool reports, e.g. backend queries. */
  ToolCost = 'tool_cost',
  Time = 'time',
}
