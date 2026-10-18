export enum TranscriptVersion {
  V1 = 1,
}

/** What the session does with the calls it sees. */
export enum TranscriptMode {
  /** Pass calls through and keep them, to save at the end. */
  Record = 'record',
  /** Answer calls from a recorded transcript; nothing reaches a model or a backend. */
  Replay = 'replay',
  /** Pass calls through untouched. */
  Off = 'off',
}

export enum TranscriptEnvVariable {
  /** `on` (the default) or `off`. */
  Record = 'HEIMDALL_RECORD',
  /** Where transcripts are kept; `~/.heimdall/runs` by default. */
  RunsDir = 'HEIMDALL_RUNS_DIR',
  /** How many transcripts are kept; the oldest go first. */
  RunsKeep = 'HEIMDALL_RUNS_KEEP',
  /** Set by `heimdall replay`: the transcript the run is answered from. */
  Replay = 'HEIMDALL_REPLAY',
  /** Set by `heimdall replay`: where the replayed run's own transcript is written. */
  ReplayOutput = 'HEIMDALL_REPLAY_OUTPUT',
}

export enum RecordSetting {
  On = 'on',
  Off = 'off',
}

/** Values a run took from outside the code, which replay hands back instead of recomputing. */
export enum TranscriptPin {
  Now = 'now',
  Sources = 'sources',
  EntryChoice = 'entryChoice',
}

export enum ReplayOutcome {
  Matched = 'matched',
  Diverged = 'diverged',
}
