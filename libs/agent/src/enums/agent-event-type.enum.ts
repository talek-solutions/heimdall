export enum AgentEventType {
  TurnStarted = 'agent.turn_started',
  ModelResponded = 'agent.model_responded',
  ToolCalled = 'agent.tool_called',
  ToolCompleted = 'agent.tool_completed',
  Finished = 'agent.finished',
}
