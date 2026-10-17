import type { TempoSpanKind, TempoStatusCode } from '@heimdall/telemetry';
import type { HopSide } from '../../enums';
import type { ICheckProblem } from '../checks/check-result.interface';
import type { ResultKind } from '../checks/result-kind.enum';
import type { OperationChange } from './evidence.enums';

/**
 * Logs, spans and traces as the agent receives them (`.docs/design/log-and-trace-evidence.md`).
 * Every string here passed the allowlist and the scrubbers; redaction is reported as counts only.
 */
export interface IEvidenceRedaction {
  readonly records: number;
  readonly fieldsDropped: number;
  readonly truncated: number;
  readonly matches: Readonly<Record<string, number>>;
}

export interface IEvidenceWindow {
  readonly start: string;
  readonly end: string;
}

interface IEvidenceResultBase {
  /** `r1`, `r2`, …: what a conclusion cites. */
  readonly result: string;
  /** The planned check, when the result answers one. */
  readonly check: string | null;
  readonly subject: string;
  readonly redaction: IEvidenceRedaction;
  /** Why nothing could be read. */
  readonly problem: ICheckProblem | null;
}

export interface ICountPair {
  readonly window: number;
  readonly baseline: number;
}

export interface ILogTemplateCount {
  /** Stable across runs: a hash of the template. */
  readonly id: string;
  /** The message with variable tokens as `<*>`. */
  readonly template: string;
  /** Lines in each sample, not totals. */
  readonly count: ICountPair;
  /** The most common severity, when the component maps one. */
  readonly severity: string | null;
}

export interface ILogExample {
  readonly at: string;
  /** Mapped fields by meaning, message cut to 300 characters. */
  readonly fields: Readonly<Record<string, string>>;
}

export interface ILogTemplate extends ILogTemplateCount {
  /** Of the window sample. */
  readonly share: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  /**
   * For a new template, whether a baseline query for its text found nothing (`true`) or something
   * the sample missed (`false`, then it is judged as surging); `null` when it has no text to query.
   */
  readonly confirmedAbsent: boolean | null;
  /** The first and the last occurrence in the window. */
  readonly examples: readonly ILogExample[];
}

export interface ILogsResult extends IEvidenceResultBase {
  readonly kind: ResultKind.Logs;
  readonly window: IEvidenceWindow;
  readonly baseline: IEvidenceWindow;
  readonly filter: {
    /** A literal line filter, from `search_logs`. */
    readonly contains: string | null;
    /** The step's match, applied to lines that carry the field. */
    readonly narrowedBy: Readonly<Record<string, string>>;
    /** Match meanings the component maps no field to. */
    readonly ignored: readonly string[];
  };
  readonly sampled: ICountPair & { readonly slices: number; readonly capped: boolean };
  /** The baseline sample is empty: the stream only exists in the window. */
  readonly streamNew: boolean;
  readonly templates: {
    readonly new: readonly ILogTemplate[];
    readonly surging: readonly ILogTemplate[];
    /** Counts only, except in a search for literal text, where they carry examples too. */
    readonly steady: readonly (ILogTemplateCount | ILogTemplate)[];
    readonly vanished: readonly ILogTemplateCount[];
  };
  /** Values of the correlation key in new and surging lines, to search the other side with. */
  readonly correlation: { readonly key: string; readonly values: readonly string[] } | null;
}

export interface IDurationPair {
  readonly window: number | null;
  readonly baseline: number | null;
}

export interface ITraceOperation {
  /** The span name. */
  readonly name: string;
  readonly changes: readonly OperationChange[];
  readonly spans: ICountPair;
  readonly durationMs: { readonly p50: IDurationPair; readonly p95: IDurationPair };
  /** Median share of the trace's duration. */
  readonly shareOfRoot: IDurationPair;
  /** Error traces in which this operation failed, in each error sample. */
  readonly errorTraces: ICountPair;
  readonly errorTypes: readonly string[];
}

export interface ITraceViewSpan {
  readonly depth: number;
  readonly service: string | null;
  readonly name: string;
  readonly kind: TempoSpanKind;
  readonly durationMs: number;
  readonly status: TempoStatusCode;
  readonly message: string | null;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly exceptions: readonly { readonly type: string | null; readonly message: string | null }[];
}

export interface ITraceView {
  readonly traceId: string;
  readonly durationMs: number;
  /** Depth first from the root, at most 40. */
  readonly spans: readonly ITraceViewSpan[];
  readonly omittedSpans: number;
}

export interface ITracesResult extends IEvidenceResultBase {
  readonly kind: ResultKind.Traces;
  readonly window: IEvidenceWindow;
  readonly baseline: IEvidenceWindow;
  readonly filter: {
    readonly side: HopSide | null;
    readonly operation: string | null;
    readonly errorsOnly: boolean;
    readonly narrowedBy: Readonly<Record<string, string>>;
    readonly ignored: readonly string[];
  };
  /** Traces in each sample, and error traces in each error sample (capped by its limit). */
  readonly sampled: ICountPair & {
    readonly errorTraces: ICountPair;
    readonly errorLimit: number;
  };
  readonly operations: readonly ITraceOperation[];
  /** The slowest error trace of the window, else its slowest trace. */
  readonly exemplar: ITraceView | null;
}

export interface ITraceResult extends IEvidenceResultBase {
  readonly kind: ResultKind.Trace;
  readonly trace: ITraceView | null;
}
