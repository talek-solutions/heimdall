import { Inject, Injectable } from '@nestjs/common';
import type { IComponentVertex, ISemanticSelector } from '@heimdall/core/graph';
import type { InteractionMode } from '@heimdall/core/manifest';
import {
  LogsSource,
  mergeRedaction,
  TelemetryError,
  TracesSource,
  type IRedactionSummary,
  type ITraceMatch,
} from '@heimdall/telemetry';
import type { IInvestigationConfig } from '../../config/investigation-config.model';
import type { HopSide } from '../../enums';
import { InvestigationErrorCode } from '../../errors';
import type { ITimeWindow } from '../../interfaces';
import { INVESTIGATION_CONFIG } from '../../investigation.tokens';
import type { ICheckProblem } from '../checks/check-result.interface';
import { ResultKind } from '../checks/result-kind.enum';
import type { ExecutionSession } from '../execution.session';
import { LogQlCompiler, narrow } from '../queries/logql.compiler';
import { TraceQlCompiler } from '../queries/traceql.compiler';
import type {
  IEvidenceRedaction,
  IEvidenceWindow,
  ILogsResult,
  ITraceResult,
  ITracesResult,
} from './evidence-result.interface';
import { LOG_SLICES, SPANS_PER_SPAN_SET, TRACE_SLICES } from './evidence.rules';
import { classifyTemplates, confirmationCandidates, tallyTemplates } from './log-evidence';
import { compareOperations, traceView } from './trace-evidence';

const CONFIRMATION_LIMIT = 1;
const TRACE_COMPONENT = 'trace';

export interface ILogsTarget {
  readonly check: string | null;
  readonly component: IComponentVertex;
  readonly match?: ISemanticSelector | undefined;
  readonly contains?: string | undefined;
  readonly correlationKey?: string | undefined;
}

export interface ITracesTarget {
  readonly check: string | null;
  readonly component: IComponentVertex;
  readonly hop?: { readonly side: HopSide; readonly mode: InteractionMode } | undefined;
  readonly match?: ISemanticSelector | undefined;
  readonly operation?: string | undefined;
  readonly errorsOnly: boolean;
}

export interface IEvidenceRun<T> {
  readonly result: T;
  /** Backend queries spent: the tool's budget cost. */
  readonly queries: number;
}

interface IWindows {
  readonly window: ITimeWindow;
  readonly baseline: ITimeWindow;
}

/**
 * Logs and traces as evidence (`.docs/design/log-and-trace-evidence.md`): time-sliced samples of
 * the window and the baseline before it, read through the redacting sources and compared.
 */
@Injectable()
export class EvidenceRunner {
  constructor(
    private readonly logsSource: LogsSource,
    private readonly tracesSource: TracesSource,
    private readonly logQl: LogQlCompiler,
    private readonly traceQl: TraceQlCompiler,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {}

  async logs(
    session: ExecutionSession,
    target: ILogsTarget,
    window: ITimeWindow,
    signal: AbortSignal,
  ): Promise<IEvidenceRun<ILogsResult>> {
    const id = session.reserveId();
    const windows = withBaseline(window);
    const compiled = this.logQl.compile(target.component, target);
    const empty = emptyLogs(id, target, windows);
    const { logs } = session.sources;

    if (!compiled.ok) {
      return this.done(session, { ...empty, problem: problemOf(compiled) }, 0);
    }
    if (!logs.ok) {
      return this.done(session, { ...empty, problem: logs.problem }, 0);
    }
    const { query, fields, narrowedBy, ignored } = compiled.compiled;
    const limit = this.config.execution.evidence.logSampleLimit;
    const read = (range: ITimeWindow, filter: string, size: number) =>
      this.logsSource.queryRange(logs.source, {
        query: filter,
        start: range.start,
        end: range.end,
        limit: size,
        fields,
        component: target.component.name,
        signal,
      });
    const filter = { contains: target.contains ?? null, narrowedBy, ignored };
    let queries = 0;

    try {
      const [current, previous] = await Promise.all(
        [windows.window, windows.baseline].map((range) =>
          Promise.all(slices(range, LOG_SLICES).map((slice) => read(slice, query, limit))),
        ),
      );
      queries += LOG_SLICES * 2;
      const batches = [...(current ?? []), ...(previous ?? [])];
      const samples = {
        window: narrow(
          (current ?? []).flatMap((batch) => batch.records),
          narrowedBy,
        ),
        baseline: narrow(
          (previous ?? []).flatMap((batch) => batch.records),
          narrowedBy,
        ),
      };
      const tallies = tallyTemplates(samples, target.correlationKey);
      const candidates = confirmationCandidates(tallies, samples.baseline.length).flatMap(
        (tally) => {
          const confirmation =
            tally.literal === undefined ? undefined : this.logQl.confirmation(query, tally.literal);
          return confirmation === undefined ? [] : [{ id: tally.id, confirmation }];
        },
      );
      const confirmed = await Promise.all(
        candidates.map(async ({ id: template, confirmation }) => {
          const found = await read(windows.baseline, confirmation, CONFIRMATION_LIMIT);
          batches.push(found);
          return [template, found.records.length === 0] as const;
        }),
      );
      queries += candidates.length;
      const redaction = mergeRedaction(batches.map((batch) => batch.redaction));

      session.noteDropped(target.component.id, redaction.droppedFields);
      return this.done(
        session,
        {
          ...empty,
          filter,
          sampled: {
            window: samples.window.length,
            baseline: samples.baseline.length,
            slices: LOG_SLICES,
            capped: (current ?? []).some((batch) => batch.records.length >= limit),
          },
          streamNew: samples.baseline.length === 0 && samples.window.length > 0,
          ...classifyTemplates(
            tallies,
            { window: samples.window.length, baseline: samples.baseline.length },
            new Map(confirmed),
            { correlationKey: target.correlationKey, searched: target.contains !== undefined },
          ),
          redaction: counts(redaction),
        },
        queries,
      );
    } catch (error) {
      return this.done(session, { ...empty, filter, problem: queryFailed(error) }, queries);
    }
  }

  async traces(
    session: ExecutionSession,
    target: ITracesTarget,
    window: ITimeWindow,
    signal: AbortSignal,
  ): Promise<IEvidenceRun<ITracesResult>> {
    const id = session.reserveId();
    const windows = withBaseline(window);
    const compiled = this.traceQl.compile(target.component, {
      side: target.hop?.side,
      mode: target.hop?.mode,
      match: target.match,
      operation: target.operation,
      errorsOnly: target.errorsOnly,
    });
    const { traces } = session.sources;
    const limit = this.config.execution.evidence.traceSampleLimit;
    const empty = emptyTraces(id, target, windows, limit);

    if (!compiled.ok) {
      return this.done(session, { ...empty, problem: problemOf(compiled) }, 0);
    }
    if (!traces.ok) {
      return this.done(session, { ...empty, problem: traces.problem }, 0);
    }
    const { query, narrowedBy, ignored } = compiled.compiled;
    const errorQuery = this.traceQl.errors(query);
    const search = (range: ITimeWindow, filter: string) =>
      this.tracesSource.search(traces.source, {
        query: filter,
        start: range.start,
        end: range.end,
        limit,
        spansPerSpanSet: SPANS_PER_SPAN_SET,
        component: target.component.name,
        signal,
      });
    const sampled = (range: ITimeWindow) =>
      target.errorsOnly
        ? Promise.resolve([])
        : Promise.all(slices(range, TRACE_SLICES).map((slice) => search(slice, query)));
    const filter = {
      side: target.hop?.side ?? null,
      operation: target.operation ?? null,
      errorsOnly: target.errorsOnly,
      narrowedBy,
      ignored,
    };
    let queries = 0;

    try {
      const [current, previous, currentErrors, previousErrors] = await Promise.all([
        sampled(windows.window),
        sampled(windows.baseline),
        search(windows.window, errorQuery),
        search(windows.baseline, errorQuery),
      ]);
      queries += (target.errorsOnly ? 0 : TRACE_SLICES * 2) + 2;
      const batches = [...current, ...previous, currentErrors, previousErrors];
      const windowTraces = current.flatMap((batch) => batch.traces);
      const exemplarId = slowest(currentErrors.traces)?.traceId ?? slowest(windowTraces)?.traceId;
      const exemplar =
        exemplarId === undefined
          ? undefined
          : await this.tracesSource.trace(traces.source, {
              traceId: exemplarId,
              component: target.component.name,
              signal,
            });
      queries += exemplar === undefined ? 0 : 1;
      const redaction = mergeRedaction([
        ...batches.map((batch) => batch.redaction),
        ...(exemplar === undefined ? [] : [exemplar.redaction]),
      ]);

      session.noteDropped(target.component.id, redaction.droppedFields);
      return this.done(
        session,
        {
          ...empty,
          filter,
          sampled: {
            window: windowTraces.length,
            baseline: previous.flatMap((batch) => batch.traces).length,
            errorTraces: {
              window: currentErrors.traces.length,
              baseline: previousErrors.traces.length,
            },
            errorLimit: limit,
          },
          operations: compareOperations({
            window: windowTraces,
            baseline: previous.flatMap((batch) => batch.traces),
            windowErrors: currentErrors.traces,
            baselineErrors: previousErrors.traces,
          }),
          exemplar: exemplar?.trace === undefined ? null : traceView(exemplar.trace),
          redaction: counts(redaction),
        },
        queries,
      );
    } catch (error) {
      return this.done(session, { ...empty, filter, problem: queryFailed(error) }, queries);
    }
  }

  async trace(
    session: ExecutionSession,
    traceId: string,
    signal: AbortSignal,
  ): Promise<IEvidenceRun<ITraceResult>> {
    const id = session.reserveId();
    const empty: ITraceResult = {
      result: id,
      kind: ResultKind.Trace,
      check: null,
      subject: `${ResultKind.Trace}:${traceId}`,
      trace: null,
      redaction: counts(undefined),
      problem: null,
    };
    const { traces } = session.sources;

    if (!traces.ok) {
      return this.done(session, { ...empty, problem: traces.problem }, 0);
    }
    try {
      const found = await this.tracesSource.trace(traces.source, {
        traceId,
        component: TRACE_COMPONENT,
        signal,
      });

      session.noteDropped(empty.subject, found.redaction.droppedFields);
      return this.done(
        session,
        {
          ...empty,
          trace: found.trace === undefined ? null : traceView(found.trace),
          redaction: counts(found.redaction),
          problem:
            found.trace === undefined
              ? {
                  errorCode: InvestigationErrorCode.TraceNotFound,
                  message: `the traces backend has no trace ${traceId}`,
                }
              : null,
        },
        1,
      );
    } catch (error) {
      return this.done(session, { ...empty, problem: queryFailed(error) }, 1);
    }
  }

  private done<T extends ILogsResult | ITracesResult | ITraceResult>(
    session: ExecutionSession,
    result: T,
    queries: number,
  ): IEvidenceRun<T> {
    session.record(result);
    return { result, queries };
  }
}

function withBaseline(window: ITimeWindow): IWindows {
  const length = window.end.getTime() - window.start.getTime();

  return {
    window,
    baseline: { start: new Date(window.start.getTime() - length), end: window.start },
  };
}

/** Equal parts, so a capped sample is spread over the range instead of crowding its end. */
function slices(range: ITimeWindow, count: number): ITimeWindow[] {
  const start = range.start.getTime();
  const step = (range.end.getTime() - start) / count;

  return Array.from({ length: count }, (_, index) => ({
    start: new Date(Math.round(start + index * step)),
    end: new Date(Math.round(start + (index + 1) * step)),
  }));
}

function slowest(traces: readonly ITraceMatch[]): ITraceMatch | undefined {
  return traces.reduce<ITraceMatch | undefined>(
    (best, trace) => ((trace.durationMs ?? 0) > (best?.durationMs ?? -1) ? trace : best),
    undefined,
  );
}

function counts(summary: IRedactionSummary | undefined): IEvidenceRedaction {
  return {
    records: summary?.records ?? 0,
    fieldsDropped: summary?.fieldsDropped ?? 0,
    truncated: summary?.truncated ?? 0,
    matches: summary?.matches ?? {},
  };
}

function problemOf(failure: ICheckProblem): ICheckProblem {
  return { errorCode: failure.errorCode, message: failure.message };
}

function queryFailed(error: unknown): ICheckProblem {
  if (!(error instanceof TelemetryError)) {
    throw error;
  }
  return {
    errorCode: InvestigationErrorCode.QueryFailed,
    message: `${error.errorCode}: ${error.message}`,
  };
}

function evidenceWindow(window: ITimeWindow): IEvidenceWindow {
  return { start: window.start.toISOString(), end: window.end.toISOString() };
}

function emptyLogs(id: string, target: ILogsTarget, windows: IWindows): ILogsResult {
  return {
    result: id,
    kind: ResultKind.Logs,
    check: target.check,
    subject: target.component.id,
    window: evidenceWindow(windows.window),
    baseline: evidenceWindow(windows.baseline),
    filter: { contains: target.contains ?? null, narrowedBy: {}, ignored: [] },
    sampled: { window: 0, baseline: 0, slices: LOG_SLICES, capped: false },
    streamNew: false,
    templates: { new: [], surging: [], steady: [], vanished: [] },
    correlation: null,
    redaction: counts(undefined),
    problem: null,
  };
}

function emptyTraces(
  id: string,
  target: ITracesTarget,
  windows: IWindows,
  errorLimit: number,
): ITracesResult {
  return {
    result: id,
    kind: ResultKind.Traces,
    check: target.check,
    subject: target.component.id,
    window: evidenceWindow(windows.window),
    baseline: evidenceWindow(windows.baseline),
    filter: {
      side: target.hop?.side ?? null,
      operation: target.operation ?? null,
      errorsOnly: target.errorsOnly,
      narrowedBy: {},
      ignored: [],
    },
    sampled: { window: 0, baseline: 0, errorTraces: { window: 0, baseline: 0 }, errorLimit },
    operations: [],
    exemplar: null,
    redaction: counts(undefined),
    problem: null,
  };
}
