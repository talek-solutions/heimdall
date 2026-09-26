import type { TempoSpanKind, TempoStatusCode } from '../tempo.enums';

/** An OTLP `AnyValue`, flattened to plain JSON. */
export type TempoAttributeValue =
  | string
  | number
  | boolean
  | null
  | readonly TempoAttributeValue[]
  | { readonly [key: string]: TempoAttributeValue };

export type TempoAttributes = Readonly<Record<string, TempoAttributeValue>>;

export interface TempoSpanEvent {
  readonly name: string;
  readonly timeUnixNano: string;
  readonly attributes: TempoAttributes;
}

export interface TempoSpan {
  /** Lowercase hex, whatever encoding Tempo used on the wire. */
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly kind: TempoSpanKind;
  /** The resource's `service.name`. */
  readonly serviceName: string | undefined;
  /** Unix epoch nanoseconds, kept as a string so no precision is lost. */
  readonly startTimeUnixNano: string;
  readonly durationMs: number;
  readonly status: { readonly code: TempoStatusCode; readonly message: string | undefined };
  readonly attributes: TempoAttributes;
  readonly resourceAttributes: TempoAttributes;
  readonly events: readonly TempoSpanEvent[];
}

export interface TempoTrace {
  readonly traceId: string;
  readonly spans: readonly TempoSpan[];
}

export interface TempoMatchedSpan {
  readonly spanId: string;
  readonly name: string | undefined;
  readonly startTimeUnixNano: string;
  readonly durationNs: string | undefined;
  readonly attributes: TempoAttributes;
}

export interface TempoSpanSet {
  /** Total matches, which can exceed `spans.length` (see `spansPerSpanSet`). */
  readonly matched: number;
  readonly spans: readonly TempoMatchedSpan[];
}

export interface TempoTraceSummary {
  /** As Tempo reports it in search, which may drop leading zeros. */
  readonly traceId: string;
  /** Absent while the root span has not been received. */
  readonly rootServiceName: string | undefined;
  readonly rootTraceName: string | undefined;
  readonly startTimeUnixNano: string;
  readonly durationMs: number | undefined;
  readonly spanSets: readonly TempoSpanSet[];
}

export interface TempoSearchResult {
  readonly traces: readonly TempoTraceSummary[];
}
