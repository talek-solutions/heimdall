/** Why a vertex is in scope. */
export enum ScopeReason {
  Entry = 'entry',
  /** Realises a suspect flow; its KPIs confirm the symptom. */
  Functionality = 'functionality',
  SuspectFlow = 'suspect-flow',
  Step = 'step',
  PathDependency = 'path-dependency',
  PathComponent = 'path-component',
  /** Serves the step's reads or writes. */
  RoutedMember = 'routed-member',
  /** Another dependency of a component in scope, hard or soft. */
  Neighbour = 'neighbour',
  /** Another caller of a component in scope, competing for it. */
  Contention = 'contention',
}
