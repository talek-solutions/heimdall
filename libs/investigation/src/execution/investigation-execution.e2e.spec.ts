import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AgentBudgetExceededError, BudgetDimension } from '@heimdall/agent';
import type { IManifestV1 } from '@heimdall/core/manifest';
import { LLM_PROVIDER, type ILLMToolResultPart } from '@heimdall/llm';
import { TelemetryEnvVariable } from '@heimdall/telemetry';
import { loadManifest, ReferenceManifest } from '../__fixtures__/investigation.fixture';
import {
  allResultsSoFar,
  call,
  corroborator,
  indicators,
  investigator,
  logsResults,
  resultsSoFar,
  RuleBasedModel,
  type Brain,
} from '../__fixtures__/scripted-investigation';
import { InvestigationEnvVariable, InvestigationEventType } from '../enums';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import type { IInvestigationEvent, IInvestigationPlan } from '../interfaces';
import { InvestigationInitService } from '../investigation-init.service';
import { InvestigationModule } from '../investigation.module';
import { ResultKind } from './checks/result-kind.enum';
import { OperationChange } from './evidence/evidence.enums';
import type { ITracesResult } from './evidence/evidence-result.interface';
import { ConclusionOutcome, ResultVerdict } from './conclusion/conclusion.enums';
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

/** The planted values of increased-latency-1/logs.yaml (documented examples and fakes). */
const PLANTED = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  's3cr3t-Passw0rd',
  'jane.doe@example.com',
  'j.smith@example.org',
  'm.garcia@example.net',
  'AKIAIOSFODNN7EXAMPLE',
];

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
