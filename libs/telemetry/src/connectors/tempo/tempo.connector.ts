import type { TelemetryHttpClient } from '../http/telemetry-http.client';
import { toUnixSeconds } from '../shared/time';
import type { TempoSearchRequest, TempoTraceRequest } from './api/tempo.request';
import type { TempoSearchResult, TempoTrace } from './api/tempo.response';
import { fromTempoSearchResponse } from './mappers/tempo-search.mapper';
import { fromTempoTraceResponse } from './mappers/tempo-trace.mapper';
import { TempoApiEndpoint } from './tempo.enums';

/** Read-only trace lookup and TraceQL search against Tempo's HTTP API. */
export class TempoConnector {
  constructor(private readonly client: TelemetryHttpClient) {}

  /** `undefined` when Tempo has no such trace: an answer, not a failure. */
  public async getTrace(request: TempoTraceRequest): Promise<TempoTrace | undefined> {
    const body = await this.client.getOptional<unknown>({
      // The ID may come from a model's tool call; it must not reshape the path.
      path: `${TempoApiEndpoint.TraceById}/${encodeURIComponent(request.traceId)}`,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return body === undefined ? undefined : fromTempoTraceResponse(body, request.traceId);
  }

  public async search(request: TempoSearchRequest): Promise<TempoSearchResult> {
    const body = await this.client.get<unknown>({
      path: TempoApiEndpoint.Search,
      params: {
        q: request.query,
        start: request.start === undefined ? undefined : toUnixSeconds(request.start),
        end: request.end === undefined ? undefined : toUnixSeconds(request.end),
        limit: request.limit,
        spss: request.spansPerSpanSet,
      },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return fromTempoSearchResponse(body);
  }
}
