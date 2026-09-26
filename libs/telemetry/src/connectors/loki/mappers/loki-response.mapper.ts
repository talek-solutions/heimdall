import { TelemetryBackend } from '@heimdall/config';
import { invalidResponse, isRecord, toLabels } from '../../shared/guards';
import { toMetricSeries, toMetricVectorSample } from '../../shared/metrics.mapper';
import type { LokiLogEntry, LokiQueryResult, LokiStream } from '../api/loki.response';
import { LokiResultType } from '../loki.enums';

const BACKEND = TelemetryBackend.Loki;

export function fromLokiResponse(body: unknown): LokiQueryResult {
  const data = isRecord(body) ? body['data'] : undefined;

  if (!isRecord(data) || !Array.isArray(data['result'])) {
    throw invalidResponse(BACKEND, 'has no data.result array');
  }
  const result: unknown[] = data['result'];

  switch (data['resultType']) {
    case LokiResultType.Streams:
      return { resultType: LokiResultType.Streams, streams: result.map(toStream) };
    case LokiResultType.Matrix:
      return {
        resultType: LokiResultType.Matrix,
        series: result.map((item) => toMetricSeries(item, BACKEND)),
      };
    case LokiResultType.Vector:
      return {
        resultType: LokiResultType.Vector,
        samples: result.map((item) => toMetricVectorSample(item, BACKEND)),
      };
    default:
      throw invalidResponse(BACKEND, `has unsupported resultType '${String(data['resultType'])}'`);
  }
}

function toStream(item: unknown): LokiStream {
  if (!isRecord(item) || !Array.isArray(item['values'])) {
    throw invalidResponse(BACKEND, 'contains a malformed stream');
  }
  return { labels: toLabels(item['stream'], BACKEND), entries: item['values'].map(toEntry) };
}

// Wire form: `[ns, line]`, with structured metadata as an optional third element (ignored).
function toEntry(value: unknown): LokiLogEntry {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'string') {
    throw invalidResponse(BACKEND, 'contains a malformed log entry');
  }
  return { timestampNs: value[0], line: value[1] };
}
