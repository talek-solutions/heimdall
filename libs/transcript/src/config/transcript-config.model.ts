export interface ITranscriptConfig {
  /** Whether runs are recorded; `--no-record` turns it off for one run. */
  readonly record: boolean;
  readonly runsDir: string;
  /** Transcripts kept in `runsDir`; the oldest go first. */
  readonly keep: number;
  /** In replay mode: the transcript to answer from, and where the replayed run writes its own. */
  readonly replay?: { readonly from: string; readonly output: string | undefined } | undefined;
}
