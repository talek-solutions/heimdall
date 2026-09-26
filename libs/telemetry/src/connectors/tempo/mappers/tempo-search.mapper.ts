import { TelemetryBackend } from '@heimdall/config';
import { invalidResponse, isRecord, optionalString } from '../../shared/guards';
import type {
  TempoMatchedSpan,
  TempoSearchResult,
  TempoSpanSet,
  TempoTraceSummary,
} from '../api/tempo.response';
import { toAttributes } from './otlp-attributes.mapper';

const BACKEND = TelemetryBackend.Tempo;

export function fromTempoSearchResponse(body: unknown): TempoSearchResult {
  if (!isRecord(body) || !Array.isArray(body['traces'])) {
    throw invalidResponse(BACKEND, 'has no traces array');
  }
  return { traces: body['traces'].map(toTraceSummary) };
}

function toTraceSummary(item: unknown): TempoTraceSummary {
  if (!isRecord(item) || typeof item['traceID'] !== 'string') {
    throw invalidResponse(BACKEND, 'contains a trace without traceID');
  }
  // Older Tempo releases return a single `spanSet`.
  const spanSets = item['spanSets'] ?? (item['spanSet'] === undefined ? [] : [item['spanSet']]);

  return {
    traceId: item['traceID'].toLowerCase(),
    rootServiceName: optionalString(item['rootServiceName']),
    rootTraceName: optionalString(item['rootTraceName']),
    startTimeUnixNano: String(item['startTimeUnixNano'] ?? ''),
    durationMs: typeof item['durationMs'] === 'number' ? item['durationMs'] : undefined,
    spanSets: Array.isArray(spanSets) ? spanSets.map(toSpanSet) : [],
  };
}

function toSpanSet(item: unknown): TempoSpanSet {
  if (!isRecord(item)) {
    throw invalidResponse(BACKEND, 'contains a malformed span set');
  }
  const spans = Array.isArray(item['spans']) ? item['spans'].map(toMatchedSpan) : [];

  return {
    matched: typeof item['matched'] === 'number' ? item['matched'] : spans.length,
    spans,
  };
}

function toMatchedSpan(item: unknown): TempoMatchedSpan {
  if (!isRecord(item) || typeof item['spanID'] !== 'string') {
    throw invalidResponse(BACKEND, 'contains a matched span without spanID');
  }
  return {
    spanId: item['spanID'].toLowerCase(),
    name: optionalString(item['name']),
    startTimeUnixNano: String(item['startTimeUnixNano'] ?? ''),
    durationNs: item['durationNanos'] === undefined ? undefined : String(item['durationNanos']),
    attributes: toAttributes(item['attributes']),
  };
}
