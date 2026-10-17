export enum ConclusionOutcome {
  CauseFound = 'cause-found',
  /** Nothing in scope is unhealthy. */
  NoSignal = 'no-signal',
  /** Something is wrong, but the evidence does not settle what. */
  Inconclusive = 'inconclusive',
}

/** The agent's reading of one result. */
export enum ResultVerdict {
  Healthy = 'healthy',
  Unhealthy = 'unhealthy',
  NoData = 'no-data',
}

export enum MitigationTier {
  /** What an engineer can do right now, often by hand. */
  Immediate = 'immediate',
  ShortTerm = 'short-term',
  /** What keeps it from happening again. */
  Prevention = 'prevention',
}
