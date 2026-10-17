import type { IRedactedSpan, IRedactedTrace, ITraceMatch } from '@heimdall/telemetry';
import { OperationChange } from './evidence.enums';
import type { ITraceOperation, ITraceView, ITraceViewSpan } from './evidence-result.interface';
import {
  MAX_ERROR_TYPES,
  MAX_EXEMPLAR_SPANS,
  MAX_OPERATIONS,
  MIN_SLOWER_DELTA_MS,
  SHARE_RATIO,
  SLOWER_RATIO,
} from './evidence.rules';

export interface ITraceSamples {
  readonly window: readonly ITraceMatch[];
  readonly baseline: readonly ITraceMatch[];
  readonly windowErrors: readonly ITraceMatch[];
  readonly baselineErrors: readonly ITraceMatch[];
}

const ERROR_TYPE = 'error.type';
const UNNAMED = '(unnamed)';

interface ISide {
  readonly durations: number[];
  readonly shares: number[];
  readonly errorTraces: Set<string>;
  readonly errorTypes: Map<string, number>;
}

interface IOperationTally {
  readonly window: ISide;
  readonly baseline: ISide;
}

/**
 * The subject's spans grouped by operation (span name), window against baseline
 * (`.docs/design/log-and-trace-evidence.md`, Traces): what got slower, what is new, what fails.
 */
export function compareOperations(samples: ITraceSamples): ITraceOperation[] {
  const operations = new Map<string, IOperationTally>();
  const tallyOf = (name: string): IOperationTally => {
    const existing = operations.get(name);

    if (existing !== undefined) {
      return existing;
    }
    const created = { window: side(), baseline: side() };
    operations.set(name, created);
    return created;
  };

  for (const [traces, pick] of [
    [samples.window, (tally: IOperationTally) => tally.window],
    [samples.baseline, (tally: IOperationTally) => tally.baseline],
  ] as const) {
    for (const trace of traces) {
      for (const span of trace.spans) {
        const tally = pick(tallyOf(span.name ?? UNNAMED));

        if (span.durationMs !== undefined) {
          tally.durations.push(span.durationMs);
          if (trace.durationMs !== undefined && trace.durationMs > 0) {
            tally.shares.push(span.durationMs / trace.durationMs);
          }
        }
      }
    }
  }
  for (const [traces, pick] of [
    [samples.windowErrors, (tally: IOperationTally) => tally.window],
    [samples.baselineErrors, (tally: IOperationTally) => tally.baseline],
  ] as const) {
    for (const trace of traces) {
      for (const span of trace.spans) {
        const tally = pick(tallyOf(span.name ?? UNNAMED));
        const type = span.attributes[ERROR_TYPE];

        tally.errorTraces.add(trace.traceId);
        if (typeof type === 'string') {
          tally.errorTypes.set(type, (tally.errorTypes.get(type) ?? 0) + 1);
        }
      }
    }
  }
  const baselineSampled = samples.baseline.length > 0;

  return [...operations]
    .map(([name, tally]) => operation(name, tally, baselineSampled))
    .sort(
      (a, b) =>
        b.changes.length - a.changes.length ||
        b.spans.window - a.spans.window ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_OPERATIONS);
}

/** A trace as a depth-first list from its roots, children by start time, capped. */
export function traceView(trace: IRedactedTrace): ITraceView {
  const byParent = new Map<string | undefined, IRedactedSpan[]>();
  const ids = new Set(trace.spans.map((span) => span.spanId));

  for (const span of trace.spans) {
    const parent =
      span.parentSpanId !== undefined && ids.has(span.parentSpanId) ? span.parentSpanId : undefined;
    byParent.set(parent, [...(byParent.get(parent) ?? []), span]);
  }
  const ordered: ITraceViewSpan[] = [];
  const visit = (span: IRedactedSpan, depth: number): void => {
    ordered.push(viewSpan(span, depth));
    for (const child of children(byParent, span.spanId)) {
      visit(child, depth + 1);
    }
  };
  const roots = children(byParent, undefined);

  roots.forEach((root) => visit(root, 0));
  return {
    traceId: trace.traceId,
    durationMs: roots.reduce((longest, root) => Math.max(longest, root.durationMs), 0),
    spans: ordered.slice(0, MAX_EXEMPLAR_SPANS),
    omittedSpans: Math.max(0, ordered.length - MAX_EXEMPLAR_SPANS),
  };
}

function operation(
  name: string,
  tally: IOperationTally,
  baselineSampled: boolean,
): ITraceOperation {
  const p50 = {
    window: percentile(tally.window.durations, 0.5),
    baseline: percentile(tally.baseline.durations, 0.5),
  };
  const share = {
    window: percentile(tally.window.shares, 0.5),
    baseline: percentile(tally.baseline.shares, 0.5),
  };
  const changes: OperationChange[] = [];

  if (
    baselineSampled &&
    tally.baseline.durations.length === 0 &&
    tally.window.durations.length > 0
  ) {
    changes.push(OperationChange.New);
  }
  if (
    (p50.window !== null &&
      p50.baseline !== null &&
      p50.window >= SLOWER_RATIO * p50.baseline &&
      p50.window - p50.baseline >= MIN_SLOWER_DELTA_MS) ||
    (share.window !== null &&
      share.baseline !== null &&
      share.window >= SHARE_RATIO * share.baseline)
  ) {
    changes.push(OperationChange.Slower);
  }
  if (tally.window.errorTraces.size > tally.baseline.errorTraces.size) {
    changes.push(OperationChange.Errors);
  }
  return {
    name,
    changes,
    spans: { window: tally.window.durations.length, baseline: tally.baseline.durations.length },
    durationMs: {
      p50: { window: round(p50.window), baseline: round(p50.baseline) },
      p95: {
        window: round(percentile(tally.window.durations, 0.95)),
        baseline: round(percentile(tally.baseline.durations, 0.95)),
      },
    },
    shareOfRoot: { window: round(share.window), baseline: round(share.baseline) },
    errorTraces: {
      window: tally.window.errorTraces.size,
      baseline: tally.baseline.errorTraces.size,
    },
    errorTypes: [...tally.window.errorTypes]
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_ERROR_TYPES)
      .map(([type]) => type),
  };
}

function viewSpan(span: IRedactedSpan, depth: number): ITraceViewSpan {
  return {
    depth,
    service: span.service ?? null,
    name: span.name,
    kind: span.kind,
    durationMs: span.durationMs,
    status: span.status.code,
    message: span.status.message ?? null,
    attributes: span.attributes,
    exceptions: span.exceptions.map(({ type, message }) => ({
      type: type ?? null,
      message: message ?? null,
    })),
  };
}

function children(
  byParent: ReadonlyMap<string | undefined, readonly IRedactedSpan[]>,
  parent: string | undefined,
): IRedactedSpan[] {
  return [...(byParent.get(parent) ?? [])].sort((a, b) => a.startMs - b.startMs);
}

function side(): ISide {
  return { durations: [], shares: [], errorTraces: new Set(), errorTypes: new Map() };
}

/** Nearest rank; `null` without values. */
function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function round(value: number | null): number | null {
  return value === null ? null : Number(value.toPrecision(4));
}
