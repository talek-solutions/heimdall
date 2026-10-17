import type { SystemGraph } from '@heimdall/core/graph';
import type { ICheck, IInvestigationPlan } from '../interfaces';
import type { ICheckResult } from './checks/check-result.interface';
import type { IExecutionSources } from './sources/telemetry-sources.resolver';

export interface IReachedPruned {
  readonly vertex: string;
  readonly reason: string;
}

/** Field names the allowlist dropped, per subject: for the local report only (ADR 0008). */
export interface IDroppedFields {
  readonly subject: string;
  readonly fields: readonly string[];
}

const MAX_DROPPED_NAMES = 50;

/** The state of one execution: what the tools share, and what the conclusion is checked against. */
export class ExecutionSession {
  readonly checks: ReadonlyMap<string, ICheck>;
  readonly reachedPruned: IReachedPruned[] = [];
  rejections = 0;
  private readonly results = new Map<string, ICheckResult>();
  private readonly dropped = new Map<string, Set<string>>();
  private next = 1;

  constructor(
    readonly graph: SystemGraph,
    readonly plan: IInvestigationPlan,
    readonly sources: IExecutionSources,
    readonly environmentLabels: Readonly<Record<string, string>>,
    private readonly onResult?: (result: ICheckResult) => void,
  ) {
    this.checks = new Map(plan.checks.map((check) => [check.id, check]));
  }

  /** Ids are reserved before any query runs, so they follow request order, not completion order. */
  reserveId(): string {
    const id = `r${this.next}`;
    this.next += 1;
    return id;
  }

  record(result: ICheckResult): void {
    this.results.set(result.result, result);
    this.onResult?.(result);
  }

  /** Kept out of every result, so the agent never sees them. */
  noteDropped(subject: string, fields: readonly string[]): void {
    const names = this.dropped.get(subject) ?? new Set<string>();

    for (const field of fields) {
      if (names.size < MAX_DROPPED_NAMES) {
        names.add(field);
      }
    }
    this.dropped.set(subject, names);
  }

  result(id: string): ICheckResult | undefined {
    return this.results.get(id);
  }

  get all(): ICheckResult[] {
    return [...this.results.values()];
  }

  get droppedFields(): IDroppedFields[] {
    return [...this.dropped]
      .filter(([, names]) => names.size > 0)
      .map(([subject, names]) => ({ subject, fields: [...names].sort() }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }
}
