import { TelemetryBackend } from '@heimdall/config';
import { invalidResponse, isRecord, optionalString } from '../../shared/guards';
import type { TempoAttributes, TempoSpan, TempoSpanEvent, TempoTrace } from '../api/tempo.response';
import { TempoSpanKind, TempoStatusCode } from '../tempo.enums';
import { toAttributes } from './otlp-attributes.mapper';

const BACKEND = TelemetryBackend.Tempo;
const HEX_ID = /^[0-9a-f]+$/i;
const UNSIGNED_INTEGER = /^\d+$/;
const NANOS_PER_MILLI = 1e6;
const SERVICE_NAME_ATTRIBUTE = 'service.name';

// OTLP numeric enum values, by index.
const SPAN_KINDS: readonly TempoSpanKind[] = [
  TempoSpanKind.Unspecified,
  TempoSpanKind.Internal,
  TempoSpanKind.Server,
  TempoSpanKind.Client,
  TempoSpanKind.Producer,
  TempoSpanKind.Consumer,
];
const STATUS_CODES: readonly TempoStatusCode[] = [
  TempoStatusCode.Unset,
  TempoStatusCode.Ok,
  TempoStatusCode.Error,
];

/**
 * Accepts the v2 envelope (`{ trace: { resourceSpans } }`) and the v1 body
 * (`{ batches }`), so falling back to the v1 endpoint needs no mapper change.
 */
export function fromTempoTraceResponse(body: unknown, traceId: string): TempoTrace {
  const container = isRecord(body) && isRecord(body['trace']) ? body['trace'] : body;

  if (!isRecord(container)) {
    throw invalidResponse(BACKEND, 'is not a JSON object');
  }
  const resourceSpans = container['resourceSpans'] ?? container['batches'];

  if (!Array.isArray(resourceSpans)) {
    throw invalidResponse(BACKEND, 'has no resourceSpans array');
  }
  return { traceId: traceId.toLowerCase(), spans: resourceSpans.flatMap(toResourceSpans) };
}

function toResourceSpans(item: unknown): TempoSpan[] {
  if (!isRecord(item)) {
    throw invalidResponse(BACKEND, 'contains malformed resourceSpans');
  }
  const resource = item['resource'];
  const resourceAttributes = toAttributes(isRecord(resource) ? resource['attributes'] : undefined);
  const scopes = item['scopeSpans'] ?? item['instrumentationLibrarySpans'] ?? [];

  if (!Array.isArray(scopes)) {
    throw invalidResponse(BACKEND, 'contains malformed scopeSpans');
  }
  return scopes.flatMap((scope: unknown) => {
    const spans = isRecord(scope) ? scope['spans'] : undefined;
    return Array.isArray(spans)
      ? spans.map((span: unknown) => toSpan(span, resourceAttributes))
      : [];
  });
}

function toSpan(span: unknown, resourceAttributes: TempoAttributes): TempoSpan {
  if (
    !isRecord(span) ||
    typeof span['traceId'] !== 'string' ||
    typeof span['spanId'] !== 'string'
  ) {
    throw invalidResponse(BACKEND, 'contains a span without traceId/spanId');
  }
  const start = toNanos(span['startTimeUnixNano']);
  const end = toNanos(span['endTimeUnixNano']);
  const parentSpanId = optionalString(span['parentSpanId']);
  const serviceName = resourceAttributes[SERVICE_NAME_ATTRIBUTE];
  const status = isRecord(span['status']) ? span['status'] : {};

  return {
    traceId: toHexId(span['traceId']),
    spanId: toHexId(span['spanId']),
    parentSpanId: parentSpanId === undefined ? undefined : toHexId(parentSpanId),
    name: typeof span['name'] === 'string' ? span['name'] : '',
    kind: toEnum(span['kind'], SPAN_KINDS, 'SPAN_KIND_', TempoSpanKind.Unspecified),
    serviceName: typeof serviceName === 'string' ? serviceName : undefined,
    startTimeUnixNano: start,
    durationMs: Number(BigInt(end) - BigInt(start)) / NANOS_PER_MILLI,
    status: {
      code: toEnum(status['code'], STATUS_CODES, 'STATUS_CODE_', TempoStatusCode.Unset),
      message: optionalString(status['message']),
    },
    attributes: toAttributes(span['attributes']),
    resourceAttributes,
    events: Array.isArray(span['events']) ? span['events'].map(toEvent) : [],
  };
}

function toEvent(event: unknown): TempoSpanEvent {
  if (!isRecord(event)) {
    throw invalidResponse(BACKEND, 'contains a malformed span event');
  }
  return {
    name: typeof event['name'] === 'string' ? event['name'] : '',
    timeUnixNano: toNanos(event['timeUnixNano']),
    attributes: toAttributes(event['attributes']),
  };
}

// uint64 fields are strings in OTLP JSON, but some encoders emit numbers.
function toNanos(value: unknown): string {
  const text = typeof value === 'number' ? String(value) : value;

  if (typeof text !== 'string' || !UNSIGNED_INTEGER.test(text)) {
    throw invalidResponse(BACKEND, 'contains a malformed nanosecond timestamp');
  }
  return text;
}

// Tempo's OTLP JSON may carry IDs base64-encoded (protobuf bytes) rather than hex.
function toHexId(value: string): string {
  return HEX_ID.test(value)
    ? value.toLowerCase()
    : Buffer.from(value, 'base64').toString('hex');
}

// OTLP JSON enums arrive as a number or as the prefixed name, e.g. `SPAN_KIND_SERVER`.
function toEnum<T extends string>(
  value: unknown,
  byIndex: readonly T[],
  prefix: string,
  fallback: T,
): T {
  if (typeof value === 'number') {
    return byIndex[value] ?? fallback;
  }
  if (typeof value === 'string') {
    const name = value.replace(prefix, '').toLowerCase();
    return byIndex.find((member) => member === name) ?? fallback;
  }
  return fallback;
}
