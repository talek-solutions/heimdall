import type { ReplayOutcome } from '../transcript.enums';
import type { IValueChange } from './json-diff';

export interface IToolResultChange {
  readonly callId: string;
  /** The tool the recorded model called, when its call was found. */
  readonly tool: string | null;
  readonly changes: readonly IValueChange[];
}

/** How a replayed run compares with the recorded one (`.docs/design/replay-and-evals.md`). */
export interface IReplayDiff {
  readonly outcome: ReplayOutcome;
  readonly strict: boolean;
  readonly modelCalls: { readonly recorded: number; readonly replayed: number };
  /** What the model was sent, besides tool results. Fails a replay only under `--strict`. */
  readonly modelInputs: readonly {
    readonly call: number;
    readonly changes: readonly IValueChange[];
  }[];
  readonly toolResults: {
    readonly compared: number;
    readonly differing: readonly IToolResultChange[];
  };
  /**
   * Source calls the replayed run did not make, ones the recorded run never made, and ones it
   * made again for other results than the recording says (ADR 0020).
   */
  readonly telemetry: {
    readonly compared: number;
    readonly missing: readonly string[];
    readonly extra: readonly string[];
    readonly relinked: readonly string[];
  };
  /** The final report (or error), without timings and the trace id. */
  readonly report: readonly IValueChange[];
}
