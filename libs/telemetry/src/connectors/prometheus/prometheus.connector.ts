import type { TelemetryHttpClient } from '../http/telemetry-http.client';
import type {
  PrometheusInstantQueryRequest,
  PrometheusRangeQueryRequest,
} from './api/prometheus.request';
import type { PrometheusQueryResult } from './api/prometheus.response';
import { PrometheusApiEndpoint } from './prometheus.enums';
import { fromPrometheusResponse } from './mappers/prometheus-response.mapper';

/**
 * Read-only PromQL queries against the Prometheus HTTP API (Mimir included, via
 * its `/prometheus` prefix in the source URL). Queries are form-POSTed so long
 * PromQL stays clear of URL length limits.
 */
export class PrometheusConnector {
  constructor(private readonly client: TelemetryHttpClient) {}

  public async query(request: PrometheusInstantQueryRequest): Promise<PrometheusQueryResult> {
    const body = await this.client.postForm<unknown>({
      path: PrometheusApiEndpoint.Query,
      params: {
        query: request.query,
        time: request.time?.toISOString(),
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return fromPrometheusResponse(body);
  }

  public async queryRange(request: PrometheusRangeQueryRequest): Promise<PrometheusQueryResult> {
    const body = await this.client.postForm<unknown>({
      path: PrometheusApiEndpoint.QueryRange,
      params: {
        query: request.query,
        start: request.start.toISOString(),
        end: request.end.toISOString(),
        step: request.stepSeconds,
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return fromPrometheusResponse(body);
  }
}
