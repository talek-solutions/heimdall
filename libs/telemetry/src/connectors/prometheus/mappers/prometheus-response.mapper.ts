import { TelemetryBackend } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../../../errors';
import { invalidResponse, isRecord } from '../../shared/guards';
import { toMetricSample, toMetricSeries, toMetricVectorSample } from '../../shared/metrics.mapper';
import type { PrometheusQueryData, PrometheusQueryResult } from '../api/prometheus.response';
import { PrometheusResponseStatus, PrometheusResultType } from '../prometheus.enums';

const BACKEND = TelemetryBackend.Prometheus;

export function fromPrometheusResponse(body: unknown): PrometheusQueryResult {
  if (!isRecord(body)) {
    throw invalidResponse(BACKEND, 'is not a JSON object');
  }
  if (body['status'] === PrometheusResponseStatus.Error) {
    throw new TelemetryError(
      TelemetryErrorCode.QueryRejected,
      `${BACKEND} rejected the query (${String(body['errorType'])}): ${String(body['error'])}`,
    );
  }
  const warnings = Array.isArray(body['warnings'])
    ? body['warnings'].filter((warning): warning is string => typeof warning === 'string')
    : [];

  return { data: toData(body['data']), warnings };
}

function toData(data: unknown): PrometheusQueryData {
  if (!isRecord(data) || !Array.isArray(data['result'])) {
    throw invalidResponse(BACKEND, 'has no data.result array');
  }
  const result: unknown[] = data['result'];

  switch (data['resultType']) {
    case PrometheusResultType.Vector:
      return {
        resultType: PrometheusResultType.Vector,
        samples: result.map((item) => toMetricVectorSample(item, BACKEND)),
      };
    case PrometheusResultType.Matrix:
      return {
        resultType: PrometheusResultType.Matrix,
        series: result.map((item) => toMetricSeries(item, BACKEND)),
      };
    case PrometheusResultType.Scalar:
      return { resultType: PrometheusResultType.Scalar, sample: toMetricSample(result, BACKEND) };
    case PrometheusResultType.String:
      return toStringData(result);
    default:
      throw invalidResponse(BACKEND, `has unsupported resultType '${String(data['resultType'])}'`);
  }
}

// Same `[unixSeconds, "value"]` tuple as a sample, but the value stays a string.
function toStringData(result: unknown[]): PrometheusQueryData {
  const sample = toMetricSample(result, BACKEND);
  return {
    resultType: PrometheusResultType.String,
    timestampMs: sample.timestampMs,
    value: result[1] as string,
  };
}
