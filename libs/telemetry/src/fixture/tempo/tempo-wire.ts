import type { SpanAttributeValue } from '../scenario/scenario.model';
import type { IGeneratedSpan, IGeneratedTrace } from './trace.generator';

const SPAN_KIND_PREFIX = 'SPAN_KIND_';
const STATUS_CODE_PREFIX = 'STATUS_CODE_';
const SERVICE_NAME = 'service.name';
const SCOPE_NAME = 'io.opentelemetry.auto';

/** OTLP JSON typed values: int64 travels as a string. */
export function toOtlpAttributes(
  attributes: Readonly<Record<string, SpanAttributeValue>>,
): { key: string; value: Record<string, unknown> }[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: toOtlpValue(value) }));
}

/** Tempo's v2 trace-by-ID body: spans grouped by the service that emitted them. */
export function toTraceBody(trace: IGeneratedTrace): unknown {
  const byService = new Map<string, IGeneratedSpan[]>();

  for (const span of trace.spans) {
    byService.set(span.service, [...(byService.get(span.service) ?? []), span]);
  }
  return {
    trace: {
      resourceSpans: [...byService].map(([service, spans]) => ({
        resource: { attributes: toOtlpAttributes({ [SERVICE_NAME]: service }) },
        scopeSpans: [{ scope: { name: SCOPE_NAME }, spans: spans.map((span) => toOtlpSpan(trace, span)) }],
      })),
    },
  };
}

function toOtlpSpan(trace: IGeneratedTrace, span: IGeneratedSpan): unknown {
  return {
    traceId: trace.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? '',
    name: span.name,
    kind: `${SPAN_KIND_PREFIX}${span.kind.toUpperCase()}`,
    startTimeUnixNano: span.startNs.toString(),
    endTimeUnixNano: (span.startNs + span.durationNs).toString(),
    attributes: toOtlpAttributes(span.attributes),
    status:
      span.statusMessage === undefined
        ? { code: `${STATUS_CODE_PREFIX}${span.status.toUpperCase()}` }
        : { code: `${STATUS_CODE_PREFIX}${span.status.toUpperCase()}`, message: span.statusMessage },
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: event.timeNs.toString(),
      attributes: toOtlpAttributes(event.attributes),
    })),
  };
}

function toOtlpValue(value: SpanAttributeValue): Record<string, unknown> {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}
