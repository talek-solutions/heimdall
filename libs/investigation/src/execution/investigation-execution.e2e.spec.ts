import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AgentBudgetExceededError, BudgetDimension } from '@heimdall/agent';
import type { IManifestV1 } from '@heimdall/core/manifest';
import {
  LLM_PROVIDER,
  LLMContentPartType,
  LLMFinishReason,
  LLMMessageRole,
  type ILLMOutputContentPart,
  type ILLMProvider,
  type ILLMProviderMessageRequest,
  type ILLMProviderMessageResponse,
  type ILLMToolResultPart,
} from '@heimdall/llm';
import { TelemetryEnvVariable } from '@heimdall/telemetry';
import { loadManifest, ReferenceManifest } from '../__fixtures__/investigation.fixture';
import { CheckKind, CheckTier, InvestigationEnvVariable, InvestigationEventType } from '../enums';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import type { IInvestigationEvent, IInvestigationPlan } from '../interfaces';
import { InvestigationInitService } from '../investigation-init.service';
import { InvestigationModule } from '../investigation.module';
import type { IRoleResult } from './checks/check-result.interface';
import { ConclusionOutcome, MitigationTier, ResultVerdict } from './conclusion/conclusion.enums';
import { ObjectiveVerdict, PreliminarySignal } from './health/health.enums';
import { InvestigationExecutionService } from './investigation-execution.service';
import { InvestigationTool } from './tools/investigation-tool.enum';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const QUERY = 'checkouts are not working';
const ENV_VARIABLES = [
  TelemetryEnvVariable.PrometheusDatasourceType,
  TelemetryEnvVariable.FixtureScenario,
  TelemetryEnvVariable.FixtureAnchor,
  InvestigationEnvVariable.MaxTurns,
];

type Brain = (request: ILLMProviderMessageRequest, turn: number) => ILLMOutputContentPart[];

/** A scripted model: each turn's tool calls are computed from what the previous turns returned. */
class RuleBasedModel implements ILLMProvider {
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

function call(
  name: InvestigationTool,
  input: Record<string, unknown>,
  id: string,
): ILLMOutputContentPart {
  return { type: LLMContentPartType.TOOL_CALL, id, name, input };
}

/** Every result returned so far, read back from the tool turns the runner sent. */
function resultsSoFar(request: ILLMProviderMessageRequest): IRoleResult[] {
  return request.messages
    .filter((message) => message.role === LLMMessageRole.TOOL && Array.isArray(message.content))
    .flatMap((message) => message.content as ILLMToolResultPart[])
    .flatMap((part) => {
      const parsed = JSON.parse(String(part.content)) as { results?: IRoleResult[] };
      return parsed.results ?? [];
    });
}

function readVerdict(result: IRoleResult): ResultVerdict {
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
function investigator(plan: IInvestigationPlan): Brain {
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

function targetOf(plan: IInvestigationPlan, step: string): string {
  return step === 'step:place-order#5' ? 'component:payment-provider' : plan.entry.vertex;
}

async function investigate(
  scenario: string,
  since: string,
  brainFor: (plan: IInvestigationPlan) => Brain,
  env: Partial<Record<InvestigationEnvVariable, string>> = {},
): Promise<{
  readonly run: Promise<Awaited<ReturnType<InvestigationExecutionService['execute']>>>;
  readonly plan: IInvestigationPlan;
  readonly events: IInvestigationEvent[];
  readonly model: RuleBasedModel;
}> {
  process.env[TelemetryEnvVariable.PrometheusDatasourceType] = 'fixture';
  process.env[TelemetryEnvVariable.FixtureScenario] = scenario;
  process.env[TelemetryEnvVariable.FixtureAnchor] = ANCHOR;
  for (const [name, value] of Object.entries(env)) {
    process.env[name] = value;
  }
  let brain: Brain = () => [];
  const model = new RuleBasedModel((request, turn) => brain(request, turn));
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), InvestigationModule],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue(model)
    .compile();
  const manifest: IManifestV1 = await loadManifest(ReferenceManifest.Checkout);
  const plan = await moduleRef.get(InvestigationInitService).prepare(manifest, {
    query: QUERY,
    environment: 'prod',
    since,
    entry: 'functionality:checkout',
  });
  const events: IInvestigationEvent[] = [];

  brain = brainFor(plan);
  const run = moduleRef
    .get(InvestigationExecutionService)
    .execute(manifest, plan, { onEvent: (event) => events.push(event) });

  return { run, plan, events, model };
}

describe('Investigation execution against the fixtures, with a scripted model', () => {
  afterEach(() => {
    for (const name of ENV_VARIABLES) {
      delete process.env[name];
    }
  });

  it('error-burst-30s: the fault starts at the provider hop, seen through payments', async () => {
    const { run, plan, events } = await investigate('error-burst-30s', '2m', investigator);
    const report = await run;
    const byCheck = (id: string, role: string) =>
      report.results.find((result) => result.check === id && result.role === role);
    const check = (subject: string) =>
      plan.checks.find((candidate) => candidate.subject === subject)?.id ?? '';

    assert.equal(report.outcome, ConclusionOutcome.CauseFound);
    assert.equal(report.conclusion?.origin?.step, 'step:place-order#5');
    assert.equal(report.conclusion?.cause?.vertex, 'component:payment-provider');
    assert.equal(
      byCheck(check('functionality:checkout'), 'kpi')?.signal,
      PreliminarySignal.Anomalous,
    );
    assert.equal(byCheck(check('flow:place-order'), 'latency')?.verdict, ObjectiveVerdict.Met);
    assert.equal(
      byCheck(check('step:place-order#1'), 'errors')?.signal,
      PreliminarySignal.Anomalous,
    );
    assert.equal(byCheck(check('step:place-order#2'), 'errors')?.signal, PreliminarySignal.Normal);
    assert.equal(byCheck(check('step:place-order#3'), 'latency')?.signal, PreliminarySignal.NoData);
    assert.equal(
      byCheck(check('step:place-order#5'), 'errors')?.signal,
      PreliminarySignal.Anomalous,
    );
    assert.equal(byCheck(check('step:place-order#1'), 'errors')?.onset, '2026-10-17T07:59:36.000Z');
    assert.ok(report.usage.toolCost > 0);
    assert.deepEqual(
      [...new Set(events.map((event) => event.type))],
      [
        InvestigationEventType.AgentTurn,
        InvestigationEventType.CheckCompleted,
        InvestigationEventType.Concluded,
      ],
    );
  });

  it('healthy-baseline: nothing deviates, so the run concludes no-signal', async () => {
    const { run } = await investigate('healthy-baseline', '60m', investigator);
    const report = await run;

    assert.equal(report.outcome, ConclusionOutcome.NoSignal);
    assert.equal(
      report.results.some((result) => result.signal === PreliminarySignal.Anomalous),
      false,
    );
  });

  it('stops with the budget error when the turn budget is spent before concluding', async () => {
    const { run } = await investigate('error-burst-30s', '2m', investigator, {
      [InvestigationEnvVariable.MaxTurns]: '1',
    });

    await assert.rejects(
      run,
      (error: unknown) =>
        error instanceof AgentBudgetExceededError && error.dimension === BudgetDimension.Turns,
    );
  });

  it('sends a conclusion that overrides an objective verdict back, then fails on the second', async () => {
    const overriding: (plan: IInvestigationPlan) => Brain = (plan) => {
      const latency = plan.checks.find((check) => check.subject === 'flow:place-order')?.id ?? '';

      return (request, turn) => {
        if (turn === 1) {
          return [call(InvestigationTool.RunChecks, { checks: [latency] }, 'call-1')];
        }
        const [result] = resultsSoFar(request);
        return [
          call(
            InvestigationTool.Conclude,
            {
              outcome: ConclusionOutcome.Inconclusive,
              summary: 'Latency looks bad.',
              verdicts: [
                { result: result?.result, verdict: ResultVerdict.Unhealthy, reason: 'slow' },
              ],
              evidence: [result?.result],
              confidence: 0.4,
              mitigations: [],
            },
            `call-${turn}`,
          ),
        ];
      };
    };
    const { run, model } = await investigate('error-burst-30s', '2m', overriding);

    await assert.rejects(
      run,
      (error: unknown) =>
        error instanceof InvestigationError &&
        error.errorCode === InvestigationErrorCode.ConclusionInvalid,
    );
    const rejection = model.requests[2]?.messages.at(-1);
    assert.match(
      String((rejection?.content as ILLMToolResultPart[])[0]?.content),
      /is healthy: its slo is met/,
    );
    assert.equal(
      model.requests[0]?.tools?.every((tool) => tool.strict === true),
      true,
    );
  });
});
