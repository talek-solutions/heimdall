/** `TRANSCRIPT_`-prefixed so the CLI can group codes by string value without collisions. */
export enum TranscriptErrorCode {
  /** A `HEIMDALL_RECORD`, `HEIMDALL_RUNS_*` or `HEIMDALL_REPLAY*` variable cannot be used. */
  InvalidConfig = 'TRANSCRIPT_INVALID_CONFIG',
  NotFound = 'TRANSCRIPT_NOT_FOUND',
  /** Not JSON, not a transcript, or a version this build cannot read. */
  Invalid = 'TRANSCRIPT_INVALID',
  /** The replayed run asked for something the transcript does not hold. */
  ReplayMiss = 'TRANSCRIPT_REPLAY_MISS',
  /** The replayed run called the model more often than the recorded one. */
  ReplayExhausted = 'TRANSCRIPT_REPLAY_EXHAUSTED',
  /** The replayed run ended without writing its own transcript. */
  ReplayFailed = 'TRANSCRIPT_REPLAY_FAILED',
}
