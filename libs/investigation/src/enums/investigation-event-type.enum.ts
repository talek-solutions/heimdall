export enum InvestigationEventType {
  Started = 'investigation.started',
  SymptomClassified = 'investigation.symptom_classified',
  EntryLocated = 'investigation.entry_located',
  ScopeResolved = 'investigation.scope_resolved',
  PlanReady = 'investigation.plan_ready',
  AgentTurn = 'investigation.agent_turn',
  CheckCompleted = 'investigation.check_completed',
  Concluded = 'investigation.concluded',
}
