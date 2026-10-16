export enum AgentOutcome {
  /** The stop tool succeeded; its input is the run's output. */
  Completed = 'completed',
  Inconclusive = 'inconclusive',
}

export enum InconclusiveReason {
  /** The model stopped without calling the stop tool, even after a nudge. */
  NoStopCall = 'no-stop-call',
  /** A provider safety filter ended the turn. */
  Refused = 'refused',
  /** The provider kept pausing past the continuation cap. */
  PauseLimit = 'pause-limit',
}
