import { IndicatorRole } from '@heimdall/core/manifest';
import {
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  type ILLMOutputContentPart,
  type ILLMProvider,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
  type ILLMToolResultPart,
} from '@heimdall/llm';
import { CheckKind, CheckTier } from '../enums';
import type { IInvestigationPlan } from '../interfaces';
import type { ICheckResult, IRoleResult } from '../execution/checks/check-result.interface';
import { ResultKind } from '../execution/checks/result-kind.enum';
import {
  ConclusionOutcome,
  MitigationTier,
  ResultVerdict,
} from '../execution/conclusion/conclusion.enums';
import type { ILogsResult } from '../execution/evidence/evidence-result.interface';
import { ObjectiveVerdict, PreliminarySignal } from '../execution/health/health.enums';
import { InvestigationTool } from '../execution/tools/investigation-tool.enum';

// A scripted execution model for specs and for recording the CI transcripts (ADR 0007): its
// tool calls follow from what earlier turns returned, so a run is deterministic and free.

export type Brain = (request: ILLMProviderMessageRequest, turn: number) => ILLMOutputContentPart[];

/** A scripted model: each turn's tool calls are computed from what the previous turns returned. */
export class RuleBasedModel implements ILLMProvider {
  readonly requests: ILLMProviderMessageRequest[] = [];

  constructor(private readonly brain: Brain) {}

  async chat(request: ILLMProviderMessageRequest): Promise<ILLMProviderMessageResponse> {
    this.requests.push(request);
    return {
      id: `msg_${this.requests.length}`,
      model: request.model,
      role: LLMMessageRole.ASSISTANT,
      content: this.brain(request, this.requests.length),
      finishReason: LLMFinishReason.TOOL_CALLS,
      usage: { inputTokens: 2_000, outputTokens: 300 },
    };
  }
}

export function call(
  name: InvestigationTool,
  input: Record<string, unknown>,
  id: string,
): ILLMOutputContentPart {
  return { type: LLMContentPartType.TOOL_CALL, id, name, input };
}

/** Every result returned so far, read back from the tool turns the runner sent. */
export function allResultsSoFar(request: ILLMProviderMessageRequest): ICheckResult[] {
  return request.messages
    .filter((message) => message.role === LLMMessageRole.TOOL && Array.isArray(message.content))
    .flatMap((message) => message.content as ILLMToolResultPart[])
    .flatMap((part) => {
      const parsed = JSON.parse(String(part.content)) as { results?: ICheckResult[] };
      return parsed.results ?? [];
    });
}

/** The indicator results so far: the ones that take a verdict. */
export function resultsSoFar(request: ILLMProviderMessageRequest): IRoleResult[] {
  return indicators(allResultsSoFar(request));
}

export function indicators(results: readonly ICheckResult[]): IRoleResult[] {
  return results.filter((result): result is IRoleResult => result.kind === ResultKind.Indicator);
}

export function readVerdict(result: IRoleResult): ResultVerdict {
  if (result.verdict !== null) {
    return {
      [ObjectiveVerdict.Met]: ResultVerdict.Healthy,
      [ObjectiveVerdict.Breached]: ResultVerdict.Unhealthy,
      [ObjectiveVerdict.NoData]: ResultVerdict.NoData,
    }[result.verdict];
  }
  return result.signal === PreliminarySignal.Anomalous
    ? ResultVerdict.Unhealthy
    : result.signal === PreliminarySignal.NoData
      ? ResultVerdict.NoData
      : ResultVerdict.Healthy;
}

/** Runs confirm and localise in one call, then concludes by the origin rule. */
export function investigator(plan: IInvestigationPlan): Brain {
  const firstPass = plan.checks
    .filter((check) => check.kind === CheckKind.Indicator)
    .filter((check) => check.tier === CheckTier.Confirm || check.tier === CheckTier.Localise)
    .map((check) => check.id);

  return (request, turn) => {
    if (turn === 1) {
      return [call(InvestigationTool.RunChecks, { checks: firstPass }, 'call-1')];
    }
    const results = resultsSoFar(request);
    const verdicts = results.map((result) => ({
      result: result.result,
      verdict: readVerdict(result),
      reason: `${result.role} ${result.verdict ?? result.signal}`,
    }));
    const unhealthy = verdicts.filter(({ verdict }) => verdict === ResultVerdict.Unhealthy);
    const failingSteps = results
      .filter((result) => result.subject.startsWith('step:'))
      .filter((result) => readVerdict(result) === ResultVerdict.Unhealthy)
      .map((result) => result.subject)
      .sort();
    const origin = failingSteps.at(-1);

    return [
      call(
        InvestigationTool.Conclude,
        origin === undefined
          ? {
              outcome: ConclusionOutcome.NoSignal,
              summary: 'Nothing in scope deviates from its baseline.',
              verdicts,
              evidence: [],
              confidence: 0.7,
              mitigations: [],
            }
          : {
              outcome: ConclusionOutcome.CauseFound,
              summary: `The fault starts at ${origin}.`,
              cause: {
                vertex: targetOf(plan, origin),
                mechanism: 'errors at the deepest failing hop',
              },
              origin: { step: origin, uncertain: false },
              verdicts,
              evidence: unhealthy.map(({ result }) => result),
              confidence: 0.8,
              mitigations: [
                {
                  tier: MitigationTier.Immediate,
                  action: 'Fail over the provider',
                  tradeoff: 'Higher fees',
                },
                {
                  tier: MitigationTier.ShortTerm,
                  action: 'Add a circuit breaker',
                  tradeoff: 'Some fast failures',
                },
                {
                  tier: MitigationTier.Prevention,
                  action: 'Add a second provider',
                  tradeoff: 'Integration cost',
                },
              ],
            },
        `call-${turn}`,
      ),
    ];
  };
}

export function targetOf(plan: IInvestigationPlan, step: string): string {
  return step === 'step:place-order#5' ? 'component:payment-provider' : plan.entry.vertex;
}

const MAX_CHECKS_PER_CALL = 10;
const MITIGATIONS = [
  {
    tier: MitigationTier.Immediate,
    action: 'Stop the batch job',
    tradeoff: 'Reconciliation waits',
  },
  { tier: MitigationTier.ShortTerm, action: 'Commit in smaller batches', tradeoff: 'More commits' },
  {
    tier: MitigationTier.Prevention,
    action: 'Run reconciliation off a replica',
    tradeoff: 'Replica cost',
  },
];

export function chunks<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

export function runChecks(ids: readonly string[], turn: number): ILLMOutputContentPart[] {
  return chunks(ids, MAX_CHECKS_PER_CALL).map((checks, index) =>
    call(InvestigationTool.RunChecks, { checks }, `call-${turn}-${index}`),
  );
}

export function logsResults(results: readonly ICheckResult[]): ILogsResult[] {
  return results.filter((result): result is ILogsResult => result.kind === ResultKind.Logs);
}

/**
 * Confirm and localise; then every check the origin step gates; then a conclusion naming the
 * contender whose logs only exist in the window, as the checkout README walks it.
 */
export function corroborator(plan: IInvestigationPlan): Brain {
  const firstPass = plan.checks
    .filter((check) => check.kind === CheckKind.Indicator)
    .filter((check) => check.tier === CheckTier.Confirm || check.tier === CheckTier.Localise)
    .map((check) => check.id);
  // Fewer calls reaching a later hop is a consequence of a slow earlier one, not a fault there.
  const judge = (result: IRoleResult): ResultVerdict => {
    const verdict = readVerdict(result);
    return verdict === ResultVerdict.Unhealthy &&
      result.subject.startsWith('step:') &&
      result.role === IndicatorRole.Throughput
      ? ResultVerdict.Healthy
      : verdict;
  };
  const deepestFailing = (results: readonly IRoleResult[]) =>
    results
      .filter((result) => result.subject.startsWith('step:'))
      .filter((result) => judge(result) === ResultVerdict.Unhealthy)
      .map((result) => result.subject)
      .sort()
      .at(-1);

  return (request, turn) => {
    if (turn === 1) {
      return runChecks(firstPass, turn);
    }
    const results = resultsSoFar(request);
    const origin = deepestFailing(results) ?? '';

    if (turn === 2) {
      return runChecks(
        plan.checks
          .filter((check) => check.when?.failingSteps.includes(origin) === true)
          .map((check) => check.id),
        turn,
      );
    }
    const logs = logsResults(allResultsSoFar(request));
    const cause = logs.find((result) => result.streamNew && result.templates.new.length > 0);
    const verdicts = results.map((result) => ({
      result: result.result,
      verdict: judge(result),
      reason: `${result.role} ${result.verdict ?? result.signal}`,
    }));

    return [
      call(
        InvestigationTool.Conclude,
        {
          outcome: ConclusionOutcome.CauseFound,
          summary: `A long transaction blocks ${origin}.`,
          cause: {
            vertex: cause?.subject ?? plan.entry.vertex,
            mechanism: 'a batch transaction holds row locks on orders',
          },
          origin: { step: origin, uncertain: false },
          verdicts,
          evidence: [
            ...verdicts
              .filter(({ verdict }) => verdict === ResultVerdict.Unhealthy)
              .map(({ result }) => result),
            ...logs.filter((result) => result.templates.new.length > 0).map(({ result }) => result),
          ],
          confidence: 0.8,
          mitigations: MITIGATIONS,
        },
        `call-${turn}`,
      ),
    ];
  };
}
