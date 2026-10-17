import type { SystemGraph } from '@heimdall/core/graph';
import type { IConnectorSource } from '@heimdall/telemetry';
import type { ICheck, IInvestigationPlan } from '../interfaces';
import type { IRoleResult } from './checks/check-result.interface';

export interface IReachedPruned {
  readonly vertex: string;
  readonly reason: string;
}

/** The state of one execution: what the tools share, and what the conclusion is checked against. */
export class ExecutionSession {
  readonly checks: ReadonlyMap<string, ICheck>;
  readonly reachedPruned: IReachedPruned[] = [];
  rejections = 0;
  private readonly results = new Map<string, IRoleResult>();
  private next = 1;

  constructor(
    readonly graph: SystemGraph,
    readonly plan: IInvestigationPlan,
    readonly source: IConnectorSource,
    readonly environmentLabels: Readonly<Record<string, string>>,
    private readonly onResult?: (result: IRoleResult) => void,
  ) {
    this.checks = new Map(plan.checks.map((check) => [check.id, check]));
  }

  /** Ids are reserved before any query runs, so they follow request order, not completion order. */
  reserveId(): string {
    const id = `r${this.next}`;
    this.next += 1;
    return id;
  }

  record(result: IRoleResult): void {
    this.results.set(result.result, result);
    this.onResult?.(result);
  }

  result(id: string): IRoleResult | undefined {
    return this.results.get(id);
  }

  get all(): IRoleResult[] {
    return [...this.results.values()];
  }
}
