import { HttpStatus } from '@nestjs/common';
import { LokiApiEndpoint, LokiDirection, LokiResultType } from '../../connectors/loki/loki.enums';
import { parseDuration } from '../engine/duration';
import { ModulatedCurve, ReferenceCurve } from '../engine/curve';
import { MetricEvaluator } from '../engine/metric-evaluator';
import { selectAllMatching, selectMatching } from '../engine/query-matcher';
import type { Timeline } from '../engine/timeline';
import {
  LOKI_DEFAULT_LIMIT,
  LOKI_DEFAULT_LOOKBACK_MS,
  LOKI_DEFAULT_STEP_POINTS,
  LOKI_MAX_ENTRIES_LIMIT,
  MAX_MATCHABLE_QUERY_LENGTH,
} from '../fixture-backend.constants';
import {
  FixtureRequestError,
  type IFixtureBackend,
  type IFixtureRequest,
  type IFixtureResponse,
} from '../fixture-backend';
import type { ILogs, ILokiSeries, IMetricSeries } from '../scenario/scenario.model';
import { LogLineGenerator, type ILogEntry } from './log-line.generator';
import type { ITraceIdSource } from './log-template';
import { compileLineFilters, isMetricQuery, rangeSelectorMs } from './logql-query';

enum LokiParam {
  Query = 'query',
  Time = 'time',
  Start = 'start',
  End = 'end',
  Step = 'step',
  Limit = 'limit',
  Direction = 'direction',
}

enum LokiResponseStatus {
  Success = 'success',
}

const NOT_FOUND_BODY = '404 page not found';
const NANOS_PER_MILLI = 1_000_000n;
const NANOS_PER_SECOND = 1_000_000_000n;
const MILLIS_PER_SECOND = 1_000;
const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+\.\d+$/;
/** Counts are whole and never negative. */
const COUNT = { seasonality: undefined, noiseStddev: undefined, min: 0, max: undefined, round: true };
/** Loki reads an integer of at most 10 digits as seconds, anything longer as nanoseconds. */
const MAX_SECONDS_DIGITS = 10;

/**
 * Loki `/loki/api/v1/query(_range)`. Errors are plain text, as Loki sends them.
 * Metric queries are answered from `series`, log queries from `streams`, whose
 * generated lines go through the query's line filters.
 */
export class LokiFixtureBackend implements IFixtureBackend {
  private readonly evaluator: MetricEvaluator;
  private readonly generator: LogLineGenerator;

  constructor(
    private readonly logs: ILogs,
    private readonly timeline: Timeline,
    seed: number,
    traces: ITraceIdSource | undefined,
  ) {
    this.evaluator = new MetricEvaluator(timeline);
    this.generator = new LogLineGenerator(seed, timeline, traces);
  }

  public handle(request: IFixtureRequest): IFixtureResponse {
    try {
      switch (request.path) {
        case LokiApiEndpoint.Query:
          return this.instant(request.params);
        case LokiApiEndpoint.QueryRange:
          return this.range(request.params);
        default:
          return { status: HttpStatus.NOT_FOUND, body: NOT_FOUND_BODY };
      }
    } catch (error) {
      if (error instanceof FixtureRequestError) {
        return { status: HttpStatus.BAD_REQUEST, body: error.message };
      }
      throw error;
    }
  }

  private instant(params: URLSearchParams): IFixtureResponse {
    const query = this.query(params);

    if (!isMetricQuery(query)) {
      throw new FixtureRequestError(
        'log queries are not supported as an instant query type, please change your query to a range query type',
      );
    }
    const timeMs = this.millis(this.parseTime(params, LokiParam.Time) ?? this.anchorNs());
    const samples = this.evaluator.vector(this.matchSeries(query), timeMs);

    return this.success(LokiResultType.Vector, samples);
  }

  private range(params: URLSearchParams): IFixtureResponse {
    const query = this.query(params);
    const endNs = this.parseTime(params, LokiParam.End) ?? this.anchorNs();
    const startNs =
      this.parseTime(params, LokiParam.Start) ?? endNs - BigInt(LOKI_DEFAULT_LOOKBACK_MS) * NANOS_PER_MILLI;

    if (endNs < startNs) {
      throw new FixtureRequestError('end timestamp must not be before or equal to start time');
    }
    return isMetricQuery(query)
      ? this.metricRange(query, startNs, endNs, params)
      : this.logRange(query, startNs, endNs, params);
  }

  private metricRange(query: string, startNs: bigint, endNs: bigint, params: URLSearchParams): IFixtureResponse {
    const startMs = this.millis(startNs);
    const endMs = this.millis(endNs);
    const stepMs = this.parseStep(params.get(LokiParam.Step)) ?? this.defaultStepMs(startMs, endMs);

    if (stepMs <= 0) {
      throw new FixtureRequestError(
        'zero or negative query resolution step widths are not accepted. Try a positive integer',
      );
    }
    const series = this.evaluator.matrix(this.matchSeries(query), startMs, endMs, stepMs);

    return this.success(LokiResultType.Matrix, series);
  }

  private logRange(query: string, startNs: bigint, endNs: bigint, params: URLSearchParams): IFixtureResponse {
    const entries = this.generator.collect(selectAllMatching(query, this.logs.streams), {
      startNs,
      endNs,
      direction: this.parseDirection(params.get(LokiParam.Direction)),
      limit: this.parseLimit(params.get(LokiParam.Limit)),
      accept: compileLineFilters(query),
    });

    return this.success(LokiResultType.Streams, this.toStreams(entries));
  }

  /** A `scaleByRange` series is a per-second curve answering a count over the query's range. */
  private matchSeries(query: string): IMetricSeries[] {
    const rangeSeconds = (rangeSelectorMs(query) ?? MILLIS_PER_SECOND) / MILLIS_PER_SECOND;

    return selectMatching(query, this.logs.series).map((series: ILokiSeries) =>
      series.scaleByRange
        ? { ...series, curve: new ModulatedCurve(new ReferenceCurve(series.curve, rangeSeconds), COUNT, 0, 1) }
        : series,
    );
  }

  private toStreams(entries: readonly ILogEntry[]): unknown[] {
    const streams = new Map<ILogEntry['stream'], [string, string][]>();

    for (const entry of entries) {
      const values = streams.get(entry.stream) ?? [];
      values.push([entry.timestampNs.toString(), entry.line]);
      streams.set(entry.stream, values);
    }
    return [...streams].map(([stream, values]) => ({ stream: stream.labels, values }));
  }

  private query(params: URLSearchParams): string {
    const query = params.get(LokiParam.Query) ?? '';

    if (query.trim() === '') {
      throw new FixtureRequestError('parse error : syntax error: unexpected $end');
    }
    if (query.length > MAX_MATCHABLE_QUERY_LENGTH) {
      throw new FixtureRequestError(`fixture: query exceeds ${MAX_MATCHABLE_QUERY_LENGTH} characters`);
    }
    return query;
  }

  /** Nanoseconds; `undefined` when the parameter is absent. */
  private parseTime(params: URLSearchParams, param: LokiParam): bigint | undefined {
    const value = params.get(param);

    if (value === null || value === '') {
      return undefined;
    }
    if (INTEGER.test(value)) {
      const digits = value.replace('-', '').length;
      return digits <= MAX_SECONDS_DIGITS ? BigInt(value) * NANOS_PER_SECOND : BigInt(value);
    }
    const millis = DECIMAL.test(value) ? Number(value) * MILLIS_PER_SECOND : Date.parse(value);

    if (Number.isNaN(millis)) {
      throw new FixtureRequestError(`invalid parameter "${param}": cannot parse "${value}" to a valid timestamp`);
    }
    return BigInt(Math.round(millis)) * NANOS_PER_MILLI;
  }

  private parseStep(value: string | null): number | undefined {
    if (value === null || value === '') {
      return undefined;
    }
    const millis = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * MILLIS_PER_SECOND : parseDuration(value);

    if (millis === undefined) {
      throw new FixtureRequestError(`invalid parameter "${LokiParam.Step}": cannot parse "${value}" to a valid duration`);
    }
    return millis;
  }

  private parseLimit(value: string | null): number {
    if (value === null || value === '') {
      return LOKI_DEFAULT_LIMIT;
    }
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new FixtureRequestError('limit must be a positive value');
    }
    if (limit > LOKI_MAX_ENTRIES_LIMIT) {
      throw new FixtureRequestError(
        `max entries limit per query exceeded, limit > max_entries_limit (${limit} > ${LOKI_MAX_ENTRIES_LIMIT})`,
      );
    }
    return limit;
  }

  private parseDirection(value: string | null): LokiDirection {
    if (value === null || value === '') {
      return LokiDirection.Backward;
    }
    const allowed = Object.values(LokiDirection);

    if (!allowed.includes(value as LokiDirection)) {
      throw new FixtureRequestError(`invalid direction "${value}"; expected one of ${allowed.join(', ')}`);
    }
    return value as LokiDirection;
  }

  /** Loki's default: about 250 points, at least one second apart. */
  private defaultStepMs(startMs: number, endMs: number): number {
    const seconds = Math.max(Math.floor((endMs - startMs) / MILLIS_PER_SECOND / LOKI_DEFAULT_STEP_POINTS), 1);
    return seconds * MILLIS_PER_SECOND;
  }

  private anchorNs(): bigint {
    return BigInt(this.timeline.anchorMs) * NANOS_PER_MILLI;
  }

  private millis(nanos: bigint): number {
    return Number(nanos / NANOS_PER_MILLI);
  }

  private success(resultType: LokiResultType, result: unknown[]): IFixtureResponse {
    return { status: HttpStatus.OK, body: { status: LokiResponseStatus.Success, data: { resultType, result } } };
  }
}
