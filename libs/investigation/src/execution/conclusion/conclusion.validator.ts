import { Injectable } from '@nestjs/common';
import { VertexIds, VertexType, type IStepVertex } from '@heimdall/core/graph';
import { InteractionMode } from '@heimdall/core/manifest';
import { ResultKind } from '../checks/result-kind.enum';
import type { ExecutionSession } from '../execution.session';
import { ObjectiveVerdict, PreliminarySignal } from '../health/health.enums';
import { ConclusionOutcome, ResultVerdict } from './conclusion.enums';
import type { IConclusion } from './conclusion.interface';

const OBJECTIVE: Readonly<Record<ObjectiveVerdict, ResultVerdict>> = {
  [ObjectiveVerdict.Met]: ResultVerdict.Healthy,
  [ObjectiveVerdict.Breached]: ResultVerdict.Unhealthy,
  [ObjectiveVerdict.NoData]: ResultVerdict.NoData,
};

/**
 * What code holds a conclusion to (ADR 0018): the problems found, in plain words the agent can act
 * on; none means the conclusion stands.
 */
@Injectable()
export class ConclusionValidator {
  validate(conclusion: IConclusion, session: ExecutionSession): string[] {
    return [
      ...this.shape(conclusion),
      ...this.references(conclusion, session),
      ...this.verdicts(conclusion, session),
      ...this.origin(conclusion, session),
    ];
  }

  private shape({ outcome, cause, evidence, mitigations }: IConclusion): string[] {
    if (outcome !== ConclusionOutcome.CauseFound) {
      return [];
    }
    return [
      ...(cause === undefined ? ['a cause-found conclusion names its cause'] : []),
      ...(evidence.length === 0 ? ['a cause-found conclusion cites at least one result'] : []),
      ...(mitigations.length === 0 ? ['a cause-found conclusion proposes mitigations'] : []),
    ];
  }

  private references(
    { cause, evidence, verdicts }: IConclusion,
    session: ExecutionSession,
  ): string[] {
    const unknown = [...new Set([...evidence, ...verdicts.map(({ result }) => result)])].filter(
      (id) => session.result(id) === undefined,
    );

    return [
      ...(cause !== undefined && session.graph.vertex(cause.vertex) === undefined
        ? [`the cause '${cause.vertex}' is not a vertex of the system`]
        : []),
      ...(unknown.length === 0 ? [] : [`no result is called ${unknown.join(', ')}`]),
    ];
  }

  /**
   * Objective verdicts stand, no data is never healthy or unhealthy, and evidence (logs, spans, a
   * trace) is cited, not judged.
   */
  private verdicts({ outcome, verdicts }: IConclusion, session: ExecutionSession): string[] {
    const problems = verdicts.flatMap(({ result: id, verdict }) => {
      const result = session.result(id);

      if (result === undefined) {
        return [];
      }
      if (result.kind !== ResultKind.Indicator) {
        return [`${id} is ${result.kind} evidence: cite it in evidence, it takes no verdict`];
      }
      const required =
        result.verdict !== null
          ? OBJECTIVE[result.verdict]
          : result.signal === PreliminarySignal.NoData
            ? ResultVerdict.NoData
            : undefined;

      return required === undefined || required === verdict
        ? []
        : [
            `${id} is ${required}: ${result.verdict === null ? 'it has no data' : `its ${result.expectation} is ${result.verdict}`}`,
          ];
    });

    if (outcome !== ConclusionOutcome.NoSignal) {
      return problems;
    }
    const unhealthy = [
      ...verdicts
        .filter(({ verdict }) => verdict === ResultVerdict.Unhealthy)
        .map(({ result }) => result),
      ...session.all
        .filter((result) => result.kind === ResultKind.Indicator)
        .filter(({ verdict }) => verdict === ObjectiveVerdict.Breached)
        .map(({ result }) => result),
    ];

    return unhealthy.length === 0
      ? problems
      : [
          ...problems,
          `no-signal contradicts unhealthy results ${[...new Set(unhealthy)].join(', ')}`,
        ];
  }

  /** The deepest unhealthy hop of a sync flow, the first unhealthy stage of an async one. */
  private origin({ origin, verdicts }: IConclusion, session: ExecutionSession): string[] {
    if (origin === undefined) {
      return [];
    }
    const step = session.graph.vertexOfType(origin.step, VertexType.Step);

    if (step === undefined) {
      return [`the origin '${origin.step}' is not a step`];
    }
    if (origin.uncertain) {
      return [];
    }
    const [path] = session.graph.path(VertexIds.flow(step.flow));
    const unhealthy = new Set(
      verdicts
        .filter(({ verdict }) => verdict === ResultVerdict.Unhealthy)
        .map(({ result }) => session.result(result)?.subject),
    );
    const failing = (path?.steps ?? []).filter((candidate) => unhealthy.has(candidate.id));
    const expected: IStepVertex | undefined =
      path?.flow.mode === InteractionMode.Async ? failing[0] : failing.at(-1);

    if (expected === undefined) {
      return [
        `no step of ${step.flow} has an unhealthy verdict, so '${origin.step}' cannot be the origin; mark it uncertain or give the verdicts`,
      ];
    }
    return expected.id === origin.step
      ? []
      : [
          `by the origin rule the fault starts at ${expected.id} (${path?.flow.mode === InteractionMode.Async ? 'the first' : 'the deepest'} unhealthy step), not ${origin.step}; mark the origin uncertain if a step without data could be it`,
        ];
  }
}
