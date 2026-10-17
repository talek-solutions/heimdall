const MAX_DROPPED_NAMES = 50;
const DROPPED_NAME = /^[\w.@$-]{1,64}$/;

/** What redaction did to one batch: counts, plus dropped field names for the local report. */
export interface IRedactionSummary {
  /** Log lines or spans read. */
  readonly records: number;
  /** Fields or attributes the allowlist dropped. */
  readonly fieldsDropped: number;
  /** Values cut to the length cap before scrubbing. */
  readonly truncated: number;
  /** Matches per scrubber or additional pattern name. */
  readonly matches: Readonly<Record<string, number>>;
  /**
   * Names of dropped fields, sorted and capped. For the local report only: never a model input,
   * a span or a metric attribute (ADR 0008).
   */
  readonly droppedFields: readonly string[];
}

export class RedactionTally {
  records = 0;
  fieldsDropped = 0;
  truncated = 0;
  private readonly matches = new Map<string, number>();
  private readonly dropped = new Set<string>();

  drop(name: string): void {
    this.fieldsDropped += 1;
    if (DROPPED_NAME.test(name)) {
      this.dropped.add(name);
    }
  }

  match(scrubber: string): void {
    this.matches.set(scrubber, (this.matches.get(scrubber) ?? 0) + 1);
  }

  summary(): IRedactionSummary {
    return {
      records: this.records,
      fieldsDropped: this.fieldsDropped,
      truncated: this.truncated,
      matches: Object.fromEntries([...this.matches].sort(([a], [b]) => a.localeCompare(b))),
      droppedFields: [...this.dropped].sort().slice(0, MAX_DROPPED_NAMES),
    };
  }
}

/** Sums batches, e.g. the slices of one check. */
export function mergeRedaction(summaries: readonly IRedactionSummary[]): IRedactionSummary {
  const matches = new Map<string, number>();
  const dropped = new Set<string>();

  for (const summary of summaries) {
    for (const [scrubber, count] of Object.entries(summary.matches)) {
      matches.set(scrubber, (matches.get(scrubber) ?? 0) + count);
    }
    summary.droppedFields.forEach((name) => dropped.add(name));
  }
  return {
    records: summaries.reduce((total, summary) => total + summary.records, 0),
    fieldsDropped: summaries.reduce((total, summary) => total + summary.fieldsDropped, 0),
    truncated: summaries.reduce((total, summary) => total + summary.truncated, 0),
    matches: Object.fromEntries([...matches].sort(([a], [b]) => a.localeCompare(b))),
    droppedFields: [...dropped].sort().slice(0, MAX_DROPPED_NAMES),
  };
}
