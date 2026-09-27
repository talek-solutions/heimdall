import { HttpStatus } from '@nestjs/common';
import {
  PrometheusApiEndpoint,
  PrometheusResponseStatus,
  PrometheusResultType,
} from '../../connectors/prometheus/prometheus.enums';
import { parseDuration } from '../engine/duration';
import { MetricEvaluator } from '../engine/metric-evaluator';
import { selectMatching } from '../engine/query-matcher';
import type { Timeline } from '../engine/timeline';
import { MAX_MATCHABLE_QUERY_LENGTH } from '../fixture-backend.constants';
import {
  FixtureRequestError,
  type IFixtureBackend,
  type IFixtureRequest,
  type IFixtureResponse,
} from '../fixture-backend';
import type { IMetricSeries } from '../scenario/scenario.model';

enum PrometheusErrorType {
  BadData = 'bad_data',
}

enum PrometheusParam {
  Query = 'query',
  Time = 'time',
  Start = 'start',
  End = 'end',
  Step = 'step',
}

const MILLIS_PER_SECOND = 1000;
const UNIX_SECONDS = /^-?\d+(?:\.\d+)?$/;
const NOT_FOUND_BODY = '404 page not found';

/**
 * Prometheus `/api/v1/query(_range)`. Validation messages follow Prometheus's
 * own, so a caller learns the same lesson from a fixture as from production.
 */
export class PrometheusFixtureBackend implements IFixtureBackend {
  private readonly evaluator: MetricEvaluator;

  constructor(
    private readonly series: readonly IMetricSeries[],
    private readonly timeline: Timeline,
  ) {
    this.evaluator = new MetricEvaluator(timeline);
  }

  public handle(request: IFixtureRequest): IFixtureResponse {
    try {
      switch (request.path) {
        case PrometheusApiEndpoint.Query:
          return this.instant(request.params);
        case PrometheusApiEndpoint.QueryRange:
          return this.range(request.params);
        default:
          return { status: HttpStatus.NOT_FOUND, body: NOT_FOUND_BODY };
      }
    } catch (error) {
      if (error instanceof FixtureRequestError) {
        return {
          status: HttpStatus.BAD_REQUEST,
          body: {
            status: PrometheusResponseStatus.Error,
            errorType: PrometheusErrorType.BadData,
            error: error.message,
          },
        };
      }
      throw error;
    }
  }

  private instant(params: URLSearchParams): IFixtureResponse {
    const matched = this.match(params);
    const raw = params.get(PrometheusParam.Time);
    // With no `time`, the server evaluates at its "now", which for a fixture is the anchor.
    const timeMs =
      raw === null || raw === '' ? this.timeline.anchorMs : this.parseTime(raw, PrometheusParam.Time);
    const result = this.evaluator.vector(matched, timeMs);

    return this.success(PrometheusResultType.Vector, result);
  }

  private range(params: URLSearchParams): IFixtureResponse {
    const matched = this.match(params);
    const startMs = this.parseTime(params.get(PrometheusParam.Start) ?? '', PrometheusParam.Start);
    const endMs = this.parseTime(params.get(PrometheusParam.End) ?? '', PrometheusParam.End);
    const stepMs = this.parseStep(params.get(PrometheusParam.Step) ?? '');

    if (endMs < startMs) {
      throw new FixtureRequestError('end timestamp must not be before start time');
    }
    if (stepMs <= 0) {
      throw new FixtureRequestError(
        'zero or negative query resolution step widths are not accepted. Try a positive integer',
      );
    }
    const result = this.evaluator.matrix(matched, startMs, endMs, stepMs);

    return this.success(PrometheusResultType.Matrix, result);
  }

  private match(params: URLSearchParams): IMetricSeries[] {
    const query = params.get(PrometheusParam.Query) ?? '';

    if (query.trim() === '') {
      throw new FixtureRequestError(
        'invalid parameter "query": 1:1: parse error: no expression found in input',
      );
    }
    if (query.length > MAX_MATCHABLE_QUERY_LENGTH) {
      throw new FixtureRequestError(
        `fixture: query exceeds ${MAX_MATCHABLE_QUERY_LENGTH} characters`,
      );
    }
    return selectMatching(query, this.series);
  }

  /** RFC 3339 or unix seconds, as Prometheus accepts. */
  private parseTime(value: string, param: PrometheusParam): number {
    const millis = UNIX_SECONDS.test(value)
      ? Number(value) * MILLIS_PER_SECOND
      : value === ''
        ? Number.NaN
        : Date.parse(value);

    if (Number.isNaN(millis)) {
      throw new FixtureRequestError(
        `invalid parameter "${param}": cannot parse "${value}" to a valid timestamp`,
      );
    }
    return millis;
  }

  /** Float seconds or a duration such as `1m`. */
  private parseStep(value: string): number {
    const millis = UNIX_SECONDS.test(value)
      ? Number(value) * MILLIS_PER_SECOND
      : parseDuration(value);

    if (millis === undefined) {
      throw new FixtureRequestError(
        `invalid parameter "${PrometheusParam.Step}": cannot parse "${value}" to a valid duration`,
      );
    }
    return millis;
  }

  private success(resultType: PrometheusResultType, result: unknown[]): IFixtureResponse {
    return {
      status: HttpStatus.OK,
      body: { status: PrometheusResponseStatus.Success, data: { resultType, result } },
    };
  }
}
