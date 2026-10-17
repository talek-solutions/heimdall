/** How a span operation differs from the baseline (`.docs/design/log-and-trace-evidence.md`). */
export enum OperationChange {
  /** Not in the baseline sample. */
  New = 'new',
  /** p50 at least 1.5× and 5 ms more, or 1.5× the share of the trace. */
  Slower = 'slower',
  /** Fails in more error traces than in the baseline's. */
  Errors = 'errors',
}
