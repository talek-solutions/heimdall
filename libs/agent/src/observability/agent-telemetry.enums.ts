/** OpenTelemetry GenAI semantic-convention attributes the runtime records (ADR 0017). */
export enum GenAiAttribute {
  OperationName = 'gen_ai.operation.name',
  ProviderName = 'gen_ai.provider.name',
  AgentName = 'gen_ai.agent.name',
  RequestModel = 'gen_ai.request.model',
  RequestMaxTokens = 'gen_ai.request.max_tokens',
  ResponseId = 'gen_ai.response.id',
  ResponseModel = 'gen_ai.response.model',
  ResponseFinishReasons = 'gen_ai.response.finish_reasons',
  UsageInputTokens = 'gen_ai.usage.input_tokens',
  UsageOutputTokens = 'gen_ai.usage.output_tokens',
  TokenType = 'gen_ai.token.type',
  ToolName = 'gen_ai.tool.name',
  ToolCallId = 'gen_ai.tool.call.id',
  ToolType = 'gen_ai.tool.type',
  /** Not GenAI-specific: the general convention for a failure's class. */
  ErrorType = 'error.type',
}

export enum GenAiOperation {
  InvokeAgent = 'invoke_agent',
  Chat = 'chat',
  ExecuteTool = 'execute_tool',
}

export enum GenAiTokenType {
  Input = 'input',
  Output = 'output',
}

export enum GenAiToolType {
  Function = 'function',
}

export enum HeimdallAttribute {
  AgentOutcome = 'heimdall.agent.outcome',
  AgentInconclusiveReason = 'heimdall.agent.inconclusive_reason',
  AgentTurns = 'heimdall.agent.turns',
  AgentToolCalls = 'heimdall.agent.tool_calls',
  CachedInputTokens = 'heimdall.usage.cached_input_tokens',
  ToolStatus = 'heimdall.tool.status',
  ToolCost = 'heimdall.tool.cost',
  BudgetDimension = 'heimdall.budget.dimension',
}

export enum AgentMetric {
  TokenUsage = 'gen_ai.client.token.usage',
  OperationDuration = 'gen_ai.client.operation.duration',
  ToolCalls = 'heimdall.agent.tool_calls',
  BudgetUsed = 'heimdall.agent.budget.used',
}
