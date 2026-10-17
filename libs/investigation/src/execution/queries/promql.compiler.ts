import { Injectable } from '@nestjs/common';
import {
  labelMatchers,
  VertexIds,
  VertexType,
  type IIndicatorVertex,
  type IMetricDefinition,
  type SystemGraph,
} from '@heimdall/core/graph';
import { ExpectationKind, IndicatorRole, LabelSemantic, MetricType } from '@heimdall/core/manifest';
import { InvestigationErrorCode } from '../../errors';
import { SLO_PERCENTILES } from '../health/expectation.evaluator';

const DEFAULT_QUANTILE = 0.99;
const ERROR_STATUS = '5..';
const ERROR_OUTCOME = 'error';

enum MatchOperator {
  Equal = '=',
  NotEqual = '!=',
  Regex = '=~',
  NotRegex = '!~',
}

enum QueryUnit {
  Ratio = 'ratio',
  PerSecond = 'per second',
  Seconds = 'seconds',
}

type Matcher = readonly [label: string, operator: MatchOperator, value: string];

export interface ICompiledQuery {
  readonly query: string;
  /** Labels a returned series may keep (ADR 0008). */
  readonly labels: readonly string[];
  readonly unit: string;
  /** The quantile a latency template computes, so its SLO bound can be checked. */
  readonly quantile: number | undefined;
}

export type ICompileResult =
  | { readonly ok: true; readonly compiled: ICompiledQuery }
  | { readonly ok: false; readonly errorCode: InvestigationErrorCode; readonly message: string };

interface ISeriesRef {
  readonly metric: IMetricDefinition;
  readonly matchers: readonly Matcher[];
  readonly labels: readonly string[];
}

/**
 * Indicator → PromQL from the graph alone (ADR 0018, Queries): one template per role and metric
 * type, the metric's labels for the selector, the owner's matchers to locate the series.
 */
@Injectable()
export class PromQlCompiler {
  compile(
    graph: SystemGraph,
    indicator: IIndicatorVertex,
    role: IndicatorRole,
    environmentLabels: Readonly<Record<string, string>>,
    rateWindowSeconds: number,
  ): ICompileResult {
    const quantile = role === IndicatorRole.Latency ? quantileOf(indicator) : undefined;

    if (indicator.query !== undefined) {
      return ok({ query: indicator.query, labels: [], unit: '', quantile });
    }
    const references =
      indicator.ratio === undefined
        ? indicator.metric === undefined
          ? []
          : [indicator.metric]
        : [indicator.ratio.numerator, indicator.ratio.denominator];
    const resolved = references.map((reference) =>
      this.resolve(graph, indicator, reference, environmentLabels),
    );
    const problem = resolved.find((entry) => !('metric' in entry));

    if (problem !== undefined && !('metric' in problem)) {
      return problem;
    }
    const series = resolved as ISeriesRef[];
    const rate = `${rateWindowSeconds}s`;
    const labels = [...new Set(series.flatMap((entry) => entry.labels))];
    const [first, second] = series;

    if (first === undefined) {
      return fail(InvestigationErrorCode.NoQueryTemplate, `${indicator.id} names no metric`);
    }
    if (second !== undefined) {
      return ok({
        query: `(${valueOf(first, rate)}) / (${valueOf(second, rate)})`,
        labels,
        unit: QueryUnit.Ratio,
        quantile: undefined,
      });
    }
    const template = templateFor(first, role, rate, quantile ?? DEFAULT_QUANTILE);

    return template === undefined
      ? fail(
          InvestigationErrorCode.NoQueryTemplate,
          `no ${role} template for ${first.metric.type} ${first.metric.reference}`,
        )
      : ok({ ...template, labels, quantile });
  }

  private resolve(
    graph: SystemGraph,
    indicator: IIndicatorVertex,
    reference: string,
    environmentLabels: Readonly<Record<string, string>>,
  ): ISeriesRef | Extract<ICompileResult, { ok: false }> {
    const metric = graph.metric(reference);

    if (metric === undefined) {
      return fail(InvestigationErrorCode.NoQueryTemplate, `no metric definition for ${reference}`);
    }
    const owner = graph.vertexOfType(VertexIds.component(metric.component), VertexType.Component);
    const identity = owner?.telemetry.metrics?.matchers;

    if (identity === undefined) {
      return fail(
        InvestigationErrorCode.NoMetricsIdentity,
        `${metric.component} declares no metrics matchers, so ${reference} cannot be told apart from other components' series`,
      );
    }
    const member = graph.vertexOfType(indicator.subject, VertexType.Member);
    const memberIdentity =
      member?.component === metric.component ? (member.telemetry.metrics?.matchers ?? {}) : {};
    const selector = labelMatchers(metric, indicator.selector);

    if (selector === undefined) {
      return fail(
        InvestigationErrorCode.NoQueryTemplate,
        `${reference} has no label for every meaning of ${indicator.id}'s selector`,
      );
    }
    const equal = (entries: Readonly<Record<string, string>>): Matcher[] =>
      Object.entries(entries).map(([label, value]) => [label, MatchOperator.Equal, value]);

    return {
      metric,
      matchers: [
        ...equal(identity),
        ...equal(memberIdentity),
        ...equal(environmentLabels),
        ...equal(selector),
      ],
      labels: [
        ...Object.keys(metric.labels),
        ...Object.keys(identity),
        ...Object.keys(memberIdentity),
      ],
    };
  }
}

function templateFor(
  ref: ISeriesRef,
  role: IndicatorRole,
  rate: string,
  quantile: number,
): Omit<ICompiledQuery, 'labels' | 'quantile'> | undefined {
  const { metric } = ref;
  const counted = metric.type === MetricType.Counter ? metric.name : `${metric.name}_count`;
  const failed = outcomeMatcher(metric, true);
  const succeeded = outcomeMatcher(metric, false);
  const rateOf = (name: string, extra?: Matcher): string =>
    `sum(rate(${name}${selector(ref.matchers, extra)}[${rate}]))`;
  const perSecond = (query: string) => ({ query, unit: QueryUnit.PerSecond });

  switch (metric.type) {
    case MetricType.Counter:
    case MetricType.Histogram:
    case MetricType.Summary:
      switch (role) {
        case IndicatorRole.Throughput:
          return perSecond(rateOf(counted));
        case IndicatorRole.Kpi:
          return perSecond(rateOf(counted, succeeded));
        case IndicatorRole.Errors:
          if (failed !== undefined) {
            return {
              query: `${rateOf(counted, failed)} / ${rateOf(counted)}`,
              unit: QueryUnit.Ratio,
            };
          }
          // A counter of failures, e.g. `role: errors` on `evicted_keys_total`.
          return metric.type === MetricType.Counter ? perSecond(rateOf(counted)) : undefined;
        case IndicatorRole.Latency:
          return metric.type === MetricType.Histogram
            ? {
                query: `histogram_quantile(${quantile}, sum by (le) (rate(${metric.name}_bucket${selector(ref.matchers)}[${rate}])))`,
                unit: metric.unit ?? QueryUnit.Seconds,
              }
            : metric.type === MetricType.Summary
              ? {
                  query: `max(${metric.name}${selector(ref.matchers, ['quantile', MatchOperator.Equal, String(quantile)])})`,
                  unit: metric.unit ?? QueryUnit.Seconds,
                }
              : undefined;
        case IndicatorRole.Saturation:
        case IndicatorRole.Lag:
          return metric.type === MetricType.Counter ? perSecond(rateOf(counted)) : undefined;
      }
      return undefined;
    case MetricType.Gauge:
      switch (role) {
        case IndicatorRole.Saturation:
        case IndicatorRole.Lag:
        case IndicatorRole.Latency:
          return { query: `max(${metric.name}${selector(ref.matchers)})`, unit: metric.unit ?? '' };
        case IndicatorRole.Throughput:
        case IndicatorRole.Errors:
        case IndicatorRole.Kpi:
          return { query: `sum(${metric.name}${selector(ref.matchers)})`, unit: metric.unit ?? '' };
      }
  }
  return undefined;
}

/** A ratio side: a rate for counted metrics, the summed value for gauges. */
function valueOf(ref: ISeriesRef, rate: string): string {
  const { metric } = ref;

  switch (metric.type) {
    case MetricType.Counter:
      return `sum(rate(${metric.name}${selector(ref.matchers)}[${rate}]))`;
    case MetricType.Histogram:
    case MetricType.Summary:
      return `sum(rate(${metric.name}_count${selector(ref.matchers)}[${rate}]))`;
    case MetricType.Gauge:
      return `sum(${metric.name}${selector(ref.matchers)})`;
  }
}

/** Failed (or, with `failed` false, successful) requests, by status code or outcome. */
function outcomeMatcher(metric: IMetricDefinition, failed: boolean): Matcher | undefined {
  const label = (meaning: LabelSemantic): string | undefined =>
    Object.entries(metric.labels).find(([, semantic]) => semantic === meaning)?.[0];
  const status = label(LabelSemantic.StatusCode);
  const outcome = label(LabelSemantic.Outcome);

  if (status !== undefined) {
    return [status, failed ? MatchOperator.Regex : MatchOperator.NotRegex, ERROR_STATUS];
  }
  if (outcome !== undefined) {
    return [outcome, failed ? MatchOperator.Equal : MatchOperator.NotEqual, ERROR_OUTCOME];
  }
  return undefined;
}

/** `extra` goes first: a route value holding `/` must not come between a metric and its status. */
function selector(matchers: readonly Matcher[], extra?: Matcher): string {
  const all = extra === undefined ? matchers : [extra, ...matchers];

  return `{${all.map(([label, operator, value]) => `${label}${operator}"${escape(value)}"`).join(',')}}`;
}

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The highest SLO percentile the indicator bounds, else p99. */
function quantileOf(indicator: IIndicatorVertex): number {
  const { expect } = indicator;

  if (expect.kind !== ExpectationKind.Slo) {
    return DEFAULT_QUANTILE;
  }
  return SLO_PERCENTILES.find(([key]) => expect[key] !== undefined)?.[1] ?? DEFAULT_QUANTILE;
}

function ok(compiled: ICompiledQuery): ICompileResult {
  return { ok: true, compiled };
}

function fail(
  errorCode: InvestigationErrorCode,
  message: string,
): Extract<ICompileResult, { ok: false }> {
  return { ok: false, errorCode, message };
}
