import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AgentBudgetExceededError, BudgetDimension } from '@heimdall/agent';
import { IndicatorRole, type IManifestV1 } from '@heimdall/core/manifest';
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
import type { ICheckResult, IRoleResult } from './checks/check-result.interface';
import { ResultKind } from './checks/result-kind.enum';
import { OperationChange } from './evidence/evidence.enums';
import type { ILogsResult, ITracesResult } from './evidence/evidence-result.interface';
import { ConclusionOutcome, MitigationTier, ResultVerdict } from './conclusion/conclusion.enums';
import { ObjectiveVerdict, PreliminarySignal } from './health/health.enums';
import { InvestigationExecutionService } from './investigation-execution.service';
import { InvestigationTool } from './tools/investigation-tool.enum';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const QUERY = 'checkouts are not working';
const ENV_VARIABLES = [
  TelemetryEnvVariable.PrometheusDatasourceType,
  TelemetryEnvVariable.LokiDatasourceType,
  TelemetryEnvVariable.TempoDatasourceType,
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
function allResultsSoFar(request: ILLMProviderMessageRequest): ICheckResult[] {
  return request.messages
    .filter((message) => message.role === LLMMessageRole.TOOL && Array.isArray(message.content))
    .flatMap((message) => message.content as ILLMToolResultPart[])
    .flatMap((part) => {
      const parsed = JSON.parse(String(part.content)) as { results?: ICheckResult[] };
      return parsed.results ?? [];
    });
}

/** The indicator results so far: the ones that take a verdict. */
function resultsSoFar(request: ILLMProviderMessageRequest): IRoleResult[] {
  return indicators(allResultsSoFar(request));
}

function indicators(results: readonly ICheckResult[]): IRoleResult[] {
  return results.filter((result): result is IRoleResult => result.kind === ResultKind.Indicator);
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
/** The planted values of increased-latency-1/logs.yaml (documented examples and fakes). */
const PLANTED = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  's3cr3t-Passw0rd',
  'jane.doe@example.com',
  'j.smith@example.org',
  'm.garcia@example.net',
  'AKIAIOSFODNN7EXAMPLE',
];

function chunks<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function runChecks(ids: readonly string[], turn: number): ILLMOutputContentPart[] {
  return chunks(ids, MAX_CHECKS_PER_CALL).map((checks, index) =>
    call(InvestigationTool.RunChecks, { checks }, `call-${turn}-${index}`),
  );
}

function logsResults(results: readonly ICheckResult[]): ILogsResult[] {
  return results.filter((result): result is ILogsResult => result.kind === ResultKind.Logs);
}

/**
 * Confirm and localise; then every check the origin step gates; then a conclusion naming the
 * contender whose logs only exist in the window, as the checkout README walks it.
 */
function corroborator(plan: IInvestigationPlan): Brain {
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

async function investigate(
  scenario: string,
  since: string,
  brainFor: (plan: IInvestigationPlan) => Brain,
  env: Partial<Record<InvestigationEnvVariable, string>> = {},
  editManifest?: (text: string) => string,
): Promise<{
  readonly run: Promise<Awaited<ReturnType<InvestigationExecutionService['execute']>>>;
  readonly plan: IInvestigationPlan;
  readonly events: IInvestigationEvent[];
  readonly model: RuleBasedModel;
}> {
  process.env[TelemetryEnvVariable.PrometheusDatasourceType] = 'fixture';
  process.env[TelemetryEnvVariable.LokiDatasourceType] = 'fixture';
  process.env[TelemetryEnvVariable.TempoDatasourceType] = 'fixture';
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
  const manifest: IManifestV1 = await loadManifest(ReferenceManifest.Checkout, editManifest);
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
      indicators(report.results).find((result) => result.check === id && result.role === role);
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
      indicators(report.results).some((result) => result.signal === PreliminarySignal.Anomalous),
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

  it('increased-latency-1: the batch job behind orders-pg is the cause, shown by its logs', async () => {
    const { run, model } = await investigate('increased-latency-1', '60m', corroborator);
    const report = await run;
    const logs = logsResults(report.results);
    const of = (subject: string) => logs.find((result) => result.subject === subject);
    const traces = report.results.find(
      (result): result is ITracesResult =>
        result.kind === ResultKind.Traces && result.subject === 'component:checkout',
    );
    const reconcile = of('component:orders-reconcile');
    const requests = JSON.stringify(model.requests);

    assert.equal(report.outcome, ConclusionOutcome.CauseFound);
    assert.equal(report.conclusion?.origin?.step, 'step:place-order#3');
    assert.equal(report.conclusion?.cause?.vertex, 'component:orders-reconcile');
    assert.ok(report.conclusion?.evidence.includes(reconcile?.result ?? ''));
    assert.equal(reconcile?.streamNew, true);
    assert.equal(reconcile?.templates.new[0]?.template, 'reconciling batch');
    assert.equal(reconcile?.templates.new[0]?.examples[0]?.fields['table'], 'orders');
    assert.match(
      of('component:orders-pg')
        ?.templates.new.map(({ template }) => template)
        .join('\n') ?? '',
      /still waiting for ShareLock/,
    );
    assert.ok(
      traces?.operations
        .find((operation) => operation.name === 'UPDATE orders')
        ?.changes.includes(OperationChange.Slower),
    );
    assert.ok(report.usage.toolCost <= 120, `${report.usage.toolCost} queries`);
    for (const planted of PLANTED) {
      assert.equal(requests.includes(planted), false, planted);
    }
    assert.ok(
      report.redaction.droppedFields
        .find(({ subject }) => subject === 'component:checkout')
        ?.fields.includes('customer'),
    );
    for (const dropped of ['"customer"', '"dsn"', '"authorization"']) {
      assert.equal(requests.includes(dropped), false, `${dropped} reached the model`);
    }
  });

  it('scrubs secrets in mapped fields before any of them reaches the model', async () => {
    const mapSecrets = (text: string) =>
      text
        .replace(
          'pool: pool }',
          'pool: pool, authorization: authorization, dsn: dsn, customer: customer }',
        )
        .replace('payment_id: paymentId }', 'payment_id: paymentId, access_key_id: accessKeyId }');
    const searches: ReadonlyArray<readonly [string, string]> = [
      ['component:checkout', 'token refresh failed'],
      ['component:checkout', 'db connect failed'],
      ['component:checkout', 'payment declined'],
      ['component:payments', 'loaded provider credentials'],
    ];
    const searcher: (plan: IInvestigationPlan) => Brain = () => (request, turn) =>
      turn === 1
        ? searches.map(([component, contains], index) =>
            call(InvestigationTool.SearchLogs, { component, contains }, `call-1-${index}`),
          )
        : [
            call(
              InvestigationTool.Conclude,
              {
                outcome: ConclusionOutcome.Inconclusive,
                summary: 'Only searched logs.',
                verdicts: [],
                evidence: allResultsSoFar(request).map(({ result }) => result),
                confidence: 0.2,
                mitigations: [],
              },
              `call-${turn}`,
            ),
          ];
    const { run, model } = await investigate(
      'increased-latency-1',
      '60m',
      searcher,
      {},
      mapSecrets,
    );
    const report = await run;
    const requests = JSON.stringify(model.requests);

    for (const scrubber of ['bearerToken', 'connectionString', 'email', 'awsAccessKey']) {
      assert.ok((report.redaction.totals.matches[scrubber] ?? 0) > 0, `${scrubber} matched`);
      assert.ok(requests.includes(`[REDACTED:${scrubber}]`), `${scrubber} token reached the model`);
    }
    for (const planted of PLANTED) {
      assert.equal(requests.includes(planted), false, planted);
    }
  });
});
