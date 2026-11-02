import { Injectable } from '@nestjs/common';
import type { IAgentUsage, InconclusiveReason } from '@heimdall/agent';
import { CheckTier } from '../../enums';
import type { IInvestigationPlan } from '../../interfaces';
import type { ICheckResult, IRoleResult } from '../checks/check-result.interface';
import { ResultKind } from '../checks/result-kind.enum';
import { ConclusionOutcome, ResultVerdict } from '../conclusion/conclusion.enums';
import type { IConclusion } from '../conclusion/conclusion.interface';
import { OBJECTIVE } from '../conclusion/conclusion.validator';
import type { IEvidenceRedaction } from '../evidence/evidence-result.interface';
import type { IDroppedFields, IReachedPruned } from '../execution.session';
import { ObjectiveVerdict, PreliminarySignal } from '../health/health.enums';
import type { IProfile } from '../health/profile.summariser';
import type {
  IInvestigationReport,
  IReportBlindSpot,
  IReportImpact,
} from '../investigation-report.interface';
import { BlindSpotTouch, ImpactStatus, ReportSchemaVersion } from './report.enums';

const MAX_KEY_FIGURES = 5;
/** Worst first: what an impact subject shows when its results disagree. */
const SEVERITY: readonly ResultVerdict[] = [
  ResultVerdict.Unhealthy,
  ResultVerdict.NoData,
  ResultVerdict.Healthy,
];

export interface IReportInput {
  readonly plan: IInvestigationPlan;
  readonly results: readonly ICheckResult[];
  readonly profiles: Readonly<Record<string, IProfile>>;
  readonly droppedFields: readonly IDroppedFields[];
  readonly reachedPruned: readonly IReachedPruned[];
  /** Absent when the agent ended without one. */
  readonly conclusion: IConclusion | undefined;
  readonly agentReason?: InconclusiveReason | undefined;
  readonly usage: IAgentUsage;
  readonly traceId?: string | undefined;
}

/**
 * The model writes the conclusion; everything the report says around it is derived here, by code
 * (ADR 0018, amendment), so impact can never read as a cause and every rule is testable offline.
 */
@Injectable()
export class ReportBuilder {
  build(input: IReportInput): IInvestigationReport {
    const { plan, results, conclusion } = input;
    const verdicts = new Map(
      (conclusion?.verdicts ?? []).map(({ result, verdict }) => [result, verdict]),
    );
    const judge = (result: IRoleResult): ResultVerdict =>
      verdicts.get(result.result) ?? read(result);

    return {
      schemaVersion: ReportSchemaVersion.V1,
      outcome: conclusion?.outcome ?? ConclusionOutcome.Inconclusive,
      conclusion,
      ...(conclusion === undefined ? { agentReason: input.agentReason } : {}),
      keyFigures: this.keyFigures(plan, results, conclusion, judge),
      blindSpots: this.blindSpots(plan, results, conclusion),
      impact: this.impact(plan, results, judge),
      plan,
      results,
      profiles: input.profiles,
      redaction: { totals: redactionTotals(results), droppedFields: input.droppedFields },
      reachedPruned: input.reachedPruned,
      usage: input.usage,
      traceId: input.traceId,
    };
  }

  /** The symptom, the origin, the cause, then breached objectives; impact has its own section. */
  private keyFigures(
    plan: IInvestigationPlan,
    results: readonly ICheckResult[],
    conclusion: IConclusion | undefined,
    judge: (result: IRoleResult) => ResultVerdict,
  ): string[] {
    const tiers = new Map(plan.checks.map(({ id, tier }) => [id, tier]));
    const tierOf = (result: ICheckResult): CheckTier | undefined =>
      result.check === null ? undefined : tiers.get(result.check);
    const unhealthy = results
      .filter((result): result is IRoleResult => result.kind === ResultKind.Indicator)
      .filter((result) => tierOf(result) !== CheckTier.Impact)
      .filter((result) => judge(result) === ResultVerdict.Unhealthy);
    const cited = new Set(conclusion?.evidence ?? []);
    const cause = conclusion?.cause?.vertex;
    const causeIndicators = unhealthy.filter(({ subject }) => subject === cause);
    // A cause without indicators is a blind spot: its cited logs and traces stand in for it.
    const causeEvidence =
      causeIndicators.length > 0
        ? causeIndicators
        : results.filter(
            (result) =>
              result.kind !== ResultKind.Indicator &&
              result.subject === cause &&
              cited.has(result.result),
          );
    const picks = [
      ...unhealthy.filter((result) => tierOf(result) === CheckTier.Confirm),
      ...unhealthy.filter(({ subject }) => subject === conclusion?.origin?.step),
      ...causeEvidence,
      ...unhealthy.filter(({ verdict }) => verdict === ObjectiveVerdict.Breached),
    ];

    return [...new Set(picks.map(({ result }) => result))].slice(0, MAX_KEY_FIGURES);
  }

  /** The plan's blind spots that the cause, the origin or a cited result's subject falls on. */
  private blindSpots(
    plan: IInvestigationPlan,
    results: readonly ICheckResult[],
    conclusion: IConclusion | undefined,
  ): IReportBlindSpot[] {
    if (conclusion === undefined) {
      return [];
    }
    const cited = new Set(conclusion.evidence);
    const citedSubjects = new Set(
      results.filter(({ result }) => cited.has(result)).map(({ subject }) => subject),
    );

    return plan.blindSpots.flatMap((spot) => {
      const touches =
        spot.vertex === conclusion.cause?.vertex
          ? BlindSpotTouch.Cause
          : spot.vertex === conclusion.origin?.step
            ? BlindSpotTouch.Origin
            : citedSubjects.has(spot.vertex)
              ? BlindSpotTouch.Evidence
              : undefined;

      return touches === undefined ? [] : [{ ...spot, touches }];
    });
  }

  /** Planned impact checks only: what else is hurt is read from them, never from the conclusion. */
  private impact(
    plan: IInvestigationPlan,
    results: readonly ICheckResult[],
    judge: (result: IRoleResult) => ResultVerdict,
  ): IReportImpact {
    const planned = plan.checks.filter(({ tier }) => tier === CheckTier.Impact);

    if (planned.length === 0) {
      return { status: ImpactStatus.NotPlanned, subjects: [] };
    }
    const subjects = [...new Set(planned.map(({ subject }) => subject))].map((vertex) => {
      const checks = new Set(
        planned.filter((check) => check.subject === vertex).map(({ id }) => id),
      );
      const own = results
        .filter((result): result is IRoleResult => result.kind === ResultKind.Indicator)
        .filter((result) => result.check !== null && checks.has(result.check));
      const verdicts = new Set(own.map(judge));

      return {
        vertex,
        verdict:
          own.length === 0 ? null : (SEVERITY.find((verdict) => verdicts.has(verdict)) ?? null),
        results: own.map(({ result }) => result),
      };
    });

    return {
      status: subjects.some(({ verdict }) => verdict !== null)
        ? ImpactStatus.Checked
        : ImpactStatus.NotRun,
      subjects,
    };
  }
}

/** Code's reading of a result the conclusion gave no verdict for. */
function read(result: IRoleResult): ResultVerdict {
  if (result.verdict !== null) {
    return OBJECTIVE[result.verdict];
  }
  return result.signal === PreliminarySignal.Anomalous
    ? ResultVerdict.Unhealthy
    : result.signal === PreliminarySignal.NoData
      ? ResultVerdict.NoData
      : ResultVerdict.Healthy;
}

/** Sums what every evidence result redacted; the counts the agent also saw. */
function redactionTotals(results: readonly ICheckResult[]): IEvidenceRedaction {
  const matches = new Map<string, number>();
  let records = 0;
  let fieldsDropped = 0;
  let truncated = 0;

  for (const result of results) {
    if (result.kind === ResultKind.Indicator) {
      continue;
    }
    records += result.redaction.records;
    fieldsDropped += result.redaction.fieldsDropped;
    truncated += result.redaction.truncated;
    for (const [scrubber, count] of Object.entries(result.redaction.matches)) {
      matches.set(scrubber, (matches.get(scrubber) ?? 0) + count);
    }
  }
  return {
    records,
    fieldsDropped,
    truncated,
    matches: Object.fromEntries([...matches].sort(([a], [b]) => a.localeCompare(b))),
  };
}
