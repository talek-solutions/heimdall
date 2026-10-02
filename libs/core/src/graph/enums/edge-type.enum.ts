/** Direction always means "depends on"; the direction data travels is a property (ADR 0015). */
export enum EdgeType {
  RealizedBy = 'REALIZED_BY',
  HasStep = 'HAS_STEP',
  Next = 'NEXT',
  Over = 'OVER',
  Calls = 'CALLS',
  Targets = 'TARGETS',
  MemberOf = 'MEMBER_OF',
  ReplicatesTo = 'REPLICATES_TO',
  Measures = 'MEASURES',
}
