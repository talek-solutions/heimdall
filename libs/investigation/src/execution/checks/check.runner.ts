import { Inject, Injectable } from '@nestjs/common';
import type { IIndicatorVertex } from '@heimdall/core/graph';
import { ExpectationKind, type IndicatorRole } from '@heimdall/core/manifest';
import { MetricsSource, TelemetryError } from '@heimdall/telemetry';
import type { IInvestigationConfig } from '../../config/investigation-config.model';
import { InvestigationErrorCode } from '../../errors';
import type { ITimeWindow } from '../../interfaces';
import { INVESTIGATION_CONFIG } from '../../investigation.tokens';
import type { ExecutionSession } from '../execution.session';
import { DeviationCalculator, type IDeviation } from '../health/deviation.calculator';
import { ExpectationEvaluator } from '../health/expectation.evaluator';
import { ObjectiveVerdict, PreliminarySignal } from '../health/health.enums';
import { PromQlCompiler } from '../queries/promql.compiler';
import { queryWindow, zoomWindow, type IQueryWindow } from '../queries/step-policy';
import type { ICheckProblem, IRoleResult } from './check-result.interface';
import { ResultKind } from './result-kind.enum';

const QUERIES_PER_ROLE = 2;
const SIGNIFICANT_DIGITS = 4;

export interface ICheckTarget {
  readonly check: string | null;
  readonly indicator: IIndicatorVertex;
  readonly roles: readonly IndicatorRole[];
}

export interface ICheckRun {
  readonly results: readonly IRoleResult[];
  /** Backend queries spent: the tool's budget cost. */
  readonly queries: number;
}

/** Compile → query window and baseline → deviation and objective verdict, per role (ADR 0018). */
@Injectable()
export class CheckRunner {
  private readonly deviations: DeviationCalculator;
  private readonly expectations: ExpectationEvaluator;

  constructor(
    private readonly metrics: MetricsSource,
    private readonly compiler: PromQlCompiler,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {
    this.deviations = new DeviationCalculator(config.execution.deviation);
    this.expectations = new ExpectationEvaluator(config.execution.deviation);
  }

  async run(
    session: ExecutionSession,
    target: ICheckTarget,
    window: ITimeWindow,
    signal: AbortSignal,
  ): Promise<ICheckRun> {
    const query = queryWindow(window, this.config.execution.stepFloorSeconds);
    const planned = target.roles.map((role) => ({ role, id: session.reserveId() }));
    const outcomes = await Promise.all(
      planned.map(({ role, id }) => this.runRole(session, target, role, id, query, signal)),
    );

    for (const { result } of outcomes) {
      session.record(result);
    }
    return {
      results: outcomes.map(({ result }) => result),
      queries: outcomes.reduce((total, { queries }) => total + queries, 0),
    };
  }

  private async runRole(
    session: ExecutionSession,
    target: ICheckTarget,
    role: IndicatorRole,
    id: string,
    window: IQueryWindow,
    signal: AbortSignal,
  ): Promise<{ readonly result: IRoleResult; readonly queries: number }> {
    const compiled = this.compiler.compile(
      session.graph,
      target.indicator,
      role,
      session.environmentLabels,
      window.rateWindowSeconds,
    );

    if (!compiled.ok) {
      return { result: this.problem(target, role, id, window, compiled), queries: 0 };
    }
    const request = {
      query: compiled.compiled.query,
      stepSeconds: window.stepSeconds,
      labels: compiled.compiled.labels,
      signal,
    };

    try {
      const [current, baseline] = await Promise.all([
        this.metrics.queryRange(session.sources.metrics, {
          ...request,
          start: window.start,
          end: window.end,
        }),
        this.metrics.queryRange(session.sources.metrics, {
          ...request,
          start: window.baselineStart,
          end: window.start,
        }),
      ]);
      // A backend that did not aggregate returns several series; the most deviant one speaks.
      const candidates = (current.length === 0 ? [{ points: [] }] : current).map(({ points }) => ({
        points,
        deviation: this.deviations.evaluate(
          points,
          baseline.flatMap((series) => series.points),
          window.expectedPoints,
          role,
        ),
      }));
      const worst = candidates.reduce((best, candidate) =>
        (candidate.deviation.peak?.z ?? -Infinity) > (best.deviation.peak?.z ?? -Infinity)
          ? candidate
          : best,
      );
      const objective = this.expectations.evaluate(
        worst.points,
        window.expectedPoints,
        target.indicator.expect,
        compiled.compiled.quantile,
      );

      return {
        result: this.result(target, role, id, window, worst.deviation, {
          unit: compiled.compiled.unit,
          verdict: objective?.verdict ?? null,
          bounds: objective?.bounds ?? null,
          breachOnsetMs: objective?.onsetMs,
        }),
        queries: QUERIES_PER_ROLE,
      };
    } catch (error) {
      if (!(error instanceof TelemetryError)) {
        throw error;
      }
      return {
        result: this.problem(target, role, id, window, {
          errorCode: InvestigationErrorCode.QueryFailed,
          message: `${error.errorCode}: ${error.message}`,
        }),
        queries: QUERIES_PER_ROLE,
      };
    }
  }

  private result(
    target: ICheckTarget,
    role: IndicatorRole,
    id: string,
    window: IQueryWindow,
    deviation: IDeviation,
    objective: {
      readonly unit: string;
      readonly verdict: ObjectiveVerdict | null;
      readonly bounds: string | null;
      readonly breachOnsetMs: number | undefined;
    },
  ): IRoleResult {
    const { peak } = deviation;
    const zoom =
      peak === undefined
        ? undefined
        : zoomWindow(
            peak.timestampMs,
            window,
            this.config.execution.stepFloorSeconds,
            deviation.signal === PreliminarySignal.Borderline,
            deviation.longestRun,
          );

    return {
      ...this.identity(target, role, id, window),
      verdict: objective.verdict,
      bounds: objective.bounds,
      signal: deviation.signal,
      direction: peak?.direction ?? null,
      unit: objective.unit,
      baseline:
        deviation.baseline === undefined
          ? null
          : { median: round(deviation.baseline.median), spread: round(deviation.baseline.spread) },
      peak:
        peak === undefined
          ? null
          : {
              value: round(peak.value),
              at: iso(peak.timestampMs),
              z: round(peak.z),
              effectPercent: Number.isFinite(peak.effect) ? round(peak.effect * 100) : null,
            },
      longestRun: deviation.longestRun,
      onset: deviation.onsetMs === undefined ? null : iso(deviation.onsetMs),
      breachOnset: objective.breachOnsetMs === undefined ? null : iso(objective.breachOnsetMs),
      coverage: round(deviation.coverage),
      zoom:
        zoom === undefined
          ? null
          : { start: zoom.start.toISOString(), end: zoom.end.toISOString() },
      problem: null,
    };
  }

  private problem(
    target: ICheckTarget,
    role: IndicatorRole,
    id: string,
    window: IQueryWindow,
    problem: ICheckProblem,
  ): IRoleResult {
    return {
      ...this.identity(target, role, id, window),
      verdict:
        target.indicator.expect.kind === ExpectationKind.Baseline ? null : ObjectiveVerdict.NoData,
      bounds: null,
      signal: PreliminarySignal.NoData,
      direction: null,
      unit: '',
      baseline: null,
      peak: null,
      longestRun: 0,
      onset: null,
      breachOnset: null,
      coverage: 0,
      zoom: null,
      problem: { errorCode: problem.errorCode, message: problem.message },
    };
  }

  private identity(
    target: ICheckTarget,
    role: IndicatorRole,
    id: string,
    window: IQueryWindow,
  ): Pick<
    IRoleResult,
    'result' | 'kind' | 'check' | 'indicator' | 'subject' | 'role' | 'expectation' | 'window'
  > {
    return {
      result: id,
      kind: ResultKind.Indicator,
      check: target.check,
      indicator: target.indicator.id,
      subject: target.indicator.subject,
      role,
      expectation: target.indicator.expect.kind,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        stepSeconds: window.stepSeconds,
      },
    };
  }
}

function round(value: number): number {
  return Number(value.toPrecision(SIGNIFICANT_DIGITS));
}

function iso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}
