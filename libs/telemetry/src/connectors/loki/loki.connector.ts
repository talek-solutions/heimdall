import type { TelemetryHttpClient } from '../http/telemetry-http.client';
import { toUnixNanos } from '../shared/time';
import type { LokiInstantQueryRequest, LokiRangeQueryRequest } from './api/loki.request';
import type { LokiQueryResult } from './api/loki.response';
import { LokiApiEndpoint } from './loki.enums';
import { fromLokiResponse } from './mappers/loki-response.mapper';

/** Read-only LogQL queries against Loki's HTTP API. */
export class LokiConnector {
  constructor(private readonly client: TelemetryHttpClient) {}

  public async query(request: LokiInstantQueryRequest): Promise<LokiQueryResult> {
    const body = await this.client.get<unknown>({
      path: LokiApiEndpoint.Query,
      params: {
        query: request.query,
        time: request.time === undefined ? undefined : toUnixNanos(request.time),
        limit: request.limit,
        direction: request.direction,
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return fromLokiResponse(body);
  }

  public async queryRange(request: LokiRangeQueryRequest): Promise<LokiQueryResult> {
    const body = await this.client.get<unknown>({
      path: LokiApiEndpoint.QueryRange,
      params: {
        query: request.query,
        start: toUnixNanos(request.start),
        end: toUnixNanos(request.end),
        step: request.stepSeconds,
        limit: request.limit,
        direction: request.direction,
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return fromLokiResponse(body);
  }
}
