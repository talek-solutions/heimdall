import type { IEntryCandidate } from './investigation-plan.interface';
import type { IInvestigationEvent } from './investigation-event.interface';

export interface IInvestigationRequest {
  /** The engineer's words, e.g. "checkouts are not working". */
  readonly query: string;
  /** A `System` environment name; optional when the manifest has exactly one. */
  readonly environment?: string | undefined;
  /** How far back to look, e.g. `30m`; defaults to the configured lookback. */
  readonly since?: string | undefined;
  /** A vertex id; skips classification entirely. */
  readonly entry?: string | undefined;
}

export interface IPrepareOptions {
  readonly onEvent?: ((event: IInvestigationEvent) => void) | undefined;
  /**
   * Asked when the model's candidates are ambiguous. Returning a candidate's vertex id picks
   * it; returning `undefined`, or leaving this out, fails with `EntryAmbiguous`.
   */
  readonly chooseEntry?:
    ((candidates: readonly IEntryCandidate[]) => Promise<string | undefined>) | undefined;
}
