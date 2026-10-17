import type { TempoSpanKind, TempoStatusCode } from '../connectors/tempo/tempo.enums';
import type { RedactedText } from '../redaction/redacted-text';
import type { IRedactionSummary } from '../redaction/redaction-tally';

export type RedactedValue = RedactedText | number | boolean;
export type RedactedAttributes = Readonly<Record<string, RedactedValue>>;

export interface ITraceSearchQuery {
  /** TraceQL, built by the caller from the manifest. */
  readonly query: string;
  readonly start: Date;
  readonly end: Date;
  readonly limit: number;
  readonly spansPerSpanSet: number;
  /** The component read; an attribute of the redaction counters. */
  readonly component: string;
  readonly signal?: AbortSignal;
}

export interface ITraceLookup {
  readonly traceId: string;
  readonly component: string;
  readonly signal?: AbortSignal;
}

/** A span a search matched: allowlisted attributes only. */
export interface IMatchedSpan {
  readonly spanId: string;
  readonly name: RedactedText | undefined;
  readonly startMs: number;
  readonly durationMs: number | undefined;
  readonly attributes: RedactedAttributes;
}

export interface ITraceMatch {
  readonly traceId: string;
  readonly rootServiceName: RedactedText | undefined;
  readonly rootName: RedactedText | undefined;
  readonly startMs: number;
  readonly durationMs: number | undefined;
  /** Matches in the trace, which can exceed `spans.length`. */
  readonly matched: number;
  readonly spans: readonly IMatchedSpan[];
}

export interface ITraceSearchBatch {
  readonly traces: readonly ITraceMatch[];
  readonly redaction: IRedactionSummary;
}

export interface IRedactedException {
  readonly type: RedactedText | undefined;
  readonly message: RedactedText | undefined;
}

export interface IRedactedSpan {
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly service: RedactedText | undefined;
  readonly name: RedactedText;
  readonly kind: TempoSpanKind;
  readonly startMs: number;
  readonly durationMs: number;
  readonly status: { readonly code: TempoStatusCode; readonly message: RedactedText | undefined };
  readonly attributes: RedactedAttributes;
  readonly exceptions: readonly IRedactedException[];
}

export interface IRedactedTrace {
  readonly traceId: string;
  readonly spans: readonly IRedactedSpan[];
}

export interface ITraceBatch {
  /** `undefined` when the backend has no such trace. */
  readonly trace: IRedactedTrace | undefined;
  readonly redaction: IRedactionSummary;
}
