/** Why a vertex was ruled out without looking. */
export enum PruneReason {
  Unreachable = 'unreachable',
  BeyondHopBudget = 'beyond-hop-budget',
  /** A member that does not serve the step's reads or writes. */
  NotRouted = 'not-routed',
}
