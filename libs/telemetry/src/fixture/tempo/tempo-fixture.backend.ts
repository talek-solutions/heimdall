import { HttpStatus } from '@nestjs/common';
import { TempoApiEndpoint } from '../../connectors/tempo/tempo.enums';
import { selectAllMatching } from '../engine/query-matcher';
import {
  MAX_MATCHABLE_QUERY_LENGTH,
  TEMPO_DEFAULT_LIMIT,
  TEMPO_DEFAULT_SEARCH_WINDOW_MS,
  TEMPO_DEFAULT_SPANS_PER_SPAN_SET,
  TEMPO_MAX_SEARCH_DURATION_MS,
} from '../fixture-backend.constants';
import {
  FixtureRequestError,
  type IFixtureBackend,
  type IFixtureRequest,
  type IFixtureResponse,
} from '../fixture-backend';
import type { Timeline } from '../engine/timeline';
import type { ITraceTemplate } from '../scenario/scenario.model';
import { toOtlpAttributes, toTraceBody } from './tempo-wire';
import type { IGeneratedTrace, TraceGenerator } from './trace.generator';
import { parseTraceQuery, type ITraceQuery } from './traceql-query';

enum TempoParam {
  Query = 'q',
  Start = 'start',
  End = 'end',
  Limit = 'limit',
  SpansPerSpanSet = 'spss',
}

const NOT_FOUND_BODY = '404 page not found';
const TRACE_NOT_FOUND_BODY = 'trace not found';
const MATCH_ALL_QUERY = '{}';
const NANOS_PER_MILLI = 1_000_000n;
const NANOS_PER_SECOND = 1_000_000_000n;
const MILLIS_PER_SECOND = 1_000;
const TRACE_ID = /^[0-9a-f]{1,32}$/i;
const UNSIGNED_INTEGER = /^\d+$/;
const SERVICE_NAME = 'service.name';

/** Tempo `/api/v2/traces/{id}` and `/api/search`, in Tempo's wire format. */
export class TempoFixtureBackend implements IFixtureBackend {
  constructor(
    private readonly templates: readonly ITraceTemplate[],
    private readonly generator: TraceGenerator,
    private readonly timeline: Timeline,
  ) {}

  public handle(request: IFixtureRequest): IFixtureResponse {
    try {
      if (request.path === TempoApiEndpoint.Search) {
        return this.search(request.params);
      }
      if (request.path.startsWith(`${TempoApiEndpoint.TraceById}/`)) {
        return this.trace(decodeURIComponent(request.path.slice(TempoApiEndpoint.TraceById.length + 1)));
      }
      return { status: HttpStatus.NOT_FOUND, body: NOT_FOUND_BODY };
    } catch (error) {
      if (error instanceof FixtureRequestError) {
        return { status: HttpStatus.BAD_REQUEST, body: error.message };
      }
      throw error;
    }
  }

  private trace(traceId: string): IFixtureResponse {
    if (!TRACE_ID.test(traceId)) {
      throw new FixtureRequestError('invalid trace id');
    }
    const trace = this.generator.find(traceId);

    return trace === undefined
      ? { status: HttpStatus.NOT_FOUND, body: TRACE_NOT_FOUND_BODY }
      : { status: HttpStatus.OK, body: toTraceBody(trace) };
  }

  private search(params: URLSearchParams): IFixtureResponse {
    const query = params.get(TempoParam.Query) || MATCH_ALL_QUERY;

    if (query.length > MAX_MATCHABLE_QUERY_LENGTH) {
      throw new FixtureRequestError(`fixture: query exceeds ${MAX_MATCHABLE_QUERY_LENGTH} characters`);
    }
    const endSeconds = this.seconds(params, TempoParam.End) ?? Math.floor(this.timeline.anchorMs / MILLIS_PER_SECOND);
    const startSeconds =
      this.seconds(params, TempoParam.Start) ?? endSeconds - TEMPO_DEFAULT_SEARCH_WINDOW_MS / MILLIS_PER_SECOND;

    if (endSeconds < startSeconds) {
      throw new FixtureRequestError(
        `http parameter start must be before end. received start=${startSeconds} end=${endSeconds}`,
      );
    }
    if ((endSeconds - startSeconds) * MILLIS_PER_SECOND > TEMPO_MAX_SEARCH_DURATION_MS) {
      throw new FixtureRequestError(
        `range specified by start and end exceeds 168h0m0s. received start=${startSeconds} end=${endSeconds}`,
      );
    }
    const traceQuery = parseTraceQuery(query);
    const spansPerSpanSet = this.positive(params, TempoParam.SpansPerSpanSet) ?? TEMPO_DEFAULT_SPANS_PER_SPAN_SET;
    const traces = this.generator.collect(selectAllMatching(query, this.templates), {
      startNs: BigInt(startSeconds) * NANOS_PER_SECOND,
      // `end` is whole seconds; the whole of its last second is in range.
      endNs: BigInt(endSeconds + 1) * NANOS_PER_SECOND - 1n,
      limit: this.positive(params, TempoParam.Limit) ?? TEMPO_DEFAULT_LIMIT,
      accept: (trace) => traceQuery.matches(trace),
    });

    return {
      status: HttpStatus.OK,
      body: {
        traces: traces.map((trace) => this.summary(trace, traceQuery, spansPerSpanSet)),
        metrics: { inspectedTraces: traces.length, completedJobs: 1, totalJobs: 1 },
      },
    };
  }

  private summary(trace: IGeneratedTrace, query: ITraceQuery, spansPerSpanSet: number): unknown {
    const root = trace.spans[0];
    const matching = query.matchingSpans(trace);

    return {
      traceID: trace.traceId,
      rootServiceName: root?.service,
      rootTraceName: root?.name,
      startTimeUnixNano: trace.startNs.toString(),
      durationMs: root === undefined ? 0 : Math.round(Number(root.durationNs / NANOS_PER_MILLI)),
      spanSets: [
        {
          spans: matching.slice(0, spansPerSpanSet).map((span) => ({
            spanID: span.spanId,
            name: span.name,
            startTimeUnixNano: span.startNs.toString(),
            durationNanos: span.durationNs.toString(),
            attributes: toOtlpAttributes({ [SERVICE_NAME]: span.service, ...span.attributes }),
          })),
          matched: matching.length,
        },
      ],
    };
  }

  private seconds(params: URLSearchParams, param: TempoParam): number | undefined {
    const value = params.get(param);

    if (value === null || value === '') {
      return undefined;
    }
    if (!UNSIGNED_INTEGER.test(value)) {
      throw new FixtureRequestError(`invalid ${param}: must be unix epoch seconds, got "${value}"`);
    }
    return Number(value);
  }

  private positive(params: URLSearchParams, param: TempoParam): number | undefined {
    const value = params.get(param);

    if (value === null || value === '') {
      return undefined;
    }
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new FixtureRequestError(`invalid ${param}: must be a positive number`);
    }
    return parsed;
  }
}
