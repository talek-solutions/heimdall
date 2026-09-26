import type { TelemetryBackend } from '@heimdall/config';
import { invalidResponse, isRecord, toLabels } from './guards';
import type { MetricSample, MetricSeries, MetricVectorSample } from './metrics.response';
import { secondsToMillis } from './time';

// Prometheus and Loki spell infinities the Go way, which `Number()` reads as NaN.
const SPECIAL_VALUES: ReadonlyMap<string, number> = new Map([
  ['+Inf', Infinity],
  ['Inf', Infinity],
  ['-Inf', -Infinity],
]);

/** Wire form: `[unixSeconds, "value"]`. */
export function toMetricSample(value: unknown, backend: TelemetryBackend): MetricSample {
  if (!Array.isArray(value) || typeof value[0] !== 'number' || typeof value[1] !== 'string') {
    throw invalidResponse(backend, 'contains a malformed sample');
  }
  return {
    timestampMs: secondsToMillis(value[0]),
    value: SPECIAL_VALUES.get(value[1]) ?? Number(value[1]),
  };
}

export function toMetricSeries(item: unknown, backend: TelemetryBackend): MetricSeries {
  if (!isRecord(item) || !Array.isArray(item['values'])) {
    throw invalidResponse(backend, 'contains a malformed matrix series');
  }
  return {
    labels: toLabels(item['metric'], backend),
    samples: item['values'].map((sample: unknown) => toMetricSample(sample, backend)),
  };
}

export function toMetricVectorSample(item: unknown, backend: TelemetryBackend): MetricVectorSample {
  if (!isRecord(item)) {
    throw invalidResponse(backend, 'contains a malformed vector sample');
  }
  return {
    labels: toLabels(item['metric'], backend),
    sample: toMetricSample(item['value'], backend),
  };
}
