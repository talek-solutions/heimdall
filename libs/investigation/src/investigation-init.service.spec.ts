import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { VertexType } from '@heimdall/core/graph';
import { IndicatorRole, type IManifestV1 } from '@heimdall/core/manifest';
import { LLM_PROVIDER } from '@heimdall/llm';
import {
  FakeLlmProvider,
  FIXED_CLOCK,
  loadManifest,
  ReferenceManifest,
  selectEntryCall,
  testConfig,
} from './__fixtures__/investigation.fixture';
import { CheckTier, EntryMethod, InvestigationEventType, SymptomMethod } from './enums';
import { AmbiguousEntryError, InvestigationError, InvestigationErrorCode } from './errors';
import type { IInvestigationEvent } from './interfaces';
import { InvestigationInitService } from './investigation-init.service';
import { InvestigationModule } from './investigation.module';
import { CLOCK, INVESTIGATION_CONFIG } from './investigation.tokens';

const CHECKOUT = {
  vertexId: 'functionality:checkout',
  confidence: 0.92,
  reason: 'placing an order',
};
const PLACE_ORDER = { vertexId: 'flow:place-order', confidence: 0.55, reason: 'the order flow' };
const CHECKOUT_SERVICE = {
  vertexId: 'component:checkout',
  confidence: 0.3,
  reason: 'the checkout service',
};
/** Neither one's scope covers the other's: real rivals. */
const PAYMENTS = { vertexId: 'component:payments', confidence: 0.6, reason: 'charging the card' };
const INVENTORY = {
  vertexId: 'component:inventory',
  confidence: 0.55,
  reason: 'reserving stock',
};

async function createService(llm: FakeLlmProvider): Promise<InvestigationInitService> {
  const moduleRef = await Test.createTestingModule({ imports: [InvestigationModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(llm)
    .overrideProvider(INVESTIGATION_CONFIG)
    .useValue(testConfig())
    .overrideProvider(CLOCK)
    .useValue(FIXED_CLOCK)
    .compile();

  return moduleRef.get(InvestigationInitService);
}

describe('InvestigationInitService', () => {
  let manifest: IManifestV1;

  before(async () => {
    manifest = await loadManifest(ReferenceManifest.Checkout);
  });

  it('plans "checkouts are not working" from one model call, emitting each stage', async () => {
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [CHECKOUT], symptomRoles: ['errors', 'throughput'] }),
    ]);
    const events: IInvestigationEvent[] = [];

    const plan = await (
      await createService(llm)
    ).prepare(
      manifest,
      { query: 'checkouts are not working', environment: 'prod' },
      { onEvent: (event) => events.push(event) },
    );

    assert.equal(llm.requests.length, 1);
    assert.deepEqual(
      events.map((event) => event.type),
      [
        InvestigationEventType.Started,
        InvestigationEventType.SymptomClassified,
        InvestigationEventType.EntryLocated,
        InvestigationEventType.ScopeResolved,
        InvestigationEventType.PlanReady,
      ],
    );
    assert.deepEqual(plan.symptom, {
      roles: [IndicatorRole.Errors, IndicatorRole.Throughput],
      method: SymptomMethod.Model,
    });
    assert.equal(plan.entry.vertex, 'functionality:checkout');
    assert.equal(plan.entry.type, VertexType.Functionality);
    assert.equal(plan.entry.method, EntryMethod.Model);
    assert.equal(plan.entry.confidence, 0.92);
    assert.deepEqual(plan.environment, { name: 'prod', context: 'prod' });
    assert.deepEqual(plan.scope.suspectFlows, ['flow:place-order']);
    assert.equal(plan.checks[0]?.tier, CheckTier.Confirm);
  });

  it('skips the model when the entry is named, checking every role', async () => {
    const llm = new FakeLlmProvider([]);

    const plan = await (
      await createService(llm)
    ).prepare(manifest, {
      query: 'checkouts are not working',
      entry: 'functionality:checkout',
    });

    assert.equal(llm.requests.length, 0);
    assert.equal(plan.entry.method, EntryMethod.Flag);
    assert.equal(plan.symptom.method, SymptomMethod.Unclassified);
    assert.deepEqual(plan.symptom.roles, Object.values(IndicatorRole));
  });

  it('rejects a named entry that is not a vertex of the system', async () => {
    await assert.rejects(
      (await createService(new FakeLlmProvider([]))).prepare(manifest, {
        query: 'x',
        entry: 'component:nope',
      }),
      (error) =>
        error instanceof InvestigationError &&
        error.errorCode === InvestigationErrorCode.EntryNotFound,
    );
  });

  it('fails as not found when nothing in the index fits', async () => {
    const llm = new FakeLlmProvider([selectEntryCall({ candidates: [], symptomRoles: [] })]);

    await assert.rejects(
      (await createService(llm)).prepare(manifest, { query: 'the coffee machine is broken' }),
      (error) =>
        error instanceof InvestigationError &&
        error.errorCode === InvestigationErrorCode.EntryNotFound,
    );
  });

  it('reports close candidates as ambiguous when nobody can choose', async () => {
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [PAYMENTS, INVENTORY], symptomRoles: [] }),
    ]);

    await assert.rejects(
      (await createService(llm)).prepare(manifest, { query: 'checkout' }),
      (error) =>
        error instanceof AmbiguousEntryError &&
        error.errorCode === InvestigationErrorCode.EntryAmbiguous &&
        error.candidates.length === 2 &&
        error.message.includes('--entry'),
    );
  });

  it('lets the caller choose among ambiguous candidates, keeping the classified symptom', async () => {
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [PAYMENTS, INVENTORY], symptomRoles: ['latency'] }),
    ]);
    const offered: string[] = [];

    const plan = await (
      await createService(llm)
    ).prepare(
      manifest,
      { query: 'checkout' },
      {
        chooseEntry: async (candidates) => {
          offered.push(...candidates.map((candidate) => candidate.vertex));
          return 'component:inventory';
        },
      },
    );

    assert.deepEqual(offered, ['component:payments', 'component:inventory']);
    assert.equal(plan.entry.vertex, 'component:inventory');
    assert.equal(plan.entry.method, EntryMethod.Prompt);
    assert.deepEqual(plan.symptom.roles, [IndicatorRole.Latency]);
  });

  it('takes the top candidate when the close ones lie within its scope', async () => {
    const top = { ...CHECKOUT, confidence: 0.6 };
    const close = { ...PLACE_ORDER, confidence: 0.5 };
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [top, close, CHECKOUT_SERVICE], symptomRoles: [] }),
    ]);

    const plan = await (await createService(llm)).prepare(manifest, { query: 'checkout' });

    assert.equal(plan.entry.vertex, 'functionality:checkout');
    assert.equal(plan.entry.method, EntryMethod.Model);
    assert.equal(plan.entry.confidence, 0.6);
    assert.equal(plan.entry.candidates.length, 3);
  });

  it('keeps the model pick between two candidates with the same scope', async () => {
    const top = { ...PLACE_ORDER, confidence: 0.6 };
    const close = { ...CHECKOUT, confidence: 0.5 };
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [top, close], symptomRoles: [] }),
    ]);

    const plan = await (await createService(llm)).prepare(manifest, { query: 'checkout' });

    assert.equal(plan.entry.vertex, 'flow:place-order');
    assert.equal(plan.entry.method, EntryMethod.Model);
  });

  it('stays ambiguous when a close candidate reaches beyond the top one', async () => {
    const top = { ...CHECKOUT_SERVICE, confidence: 0.6 };
    const close = { ...CHECKOUT, confidence: 0.5 };
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [top, close], symptomRoles: [] }),
    ]);

    await assert.rejects(
      (await createService(llm)).prepare(manifest, { query: 'checkout' }),
      (error) => error instanceof AmbiguousEntryError && error.candidates.length === 2,
    );
  });

  it('does not count a runner-up exactly the margin away as close', async () => {
    const apart = { ...INVENTORY, confidence: 0.45 };
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [PAYMENTS, apart], symptomRoles: [] }),
    ]);

    const plan = await (await createService(llm)).prepare(manifest, { query: 'payments' });

    assert.equal(plan.entry.vertex, 'component:payments');
    assert.equal(plan.entry.method, EntryMethod.Model);
  });

  it('stays ambiguous under the minimum confidence, however the others nest', async () => {
    const top = { ...CHECKOUT, confidence: 0.45 };
    const close = { ...PLACE_ORDER, confidence: 0.4 };
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [top, close], symptomRoles: [] }),
    ]);

    await assert.rejects(
      (await createService(llm)).prepare(manifest, { query: 'checkout' }),
      (error) => error instanceof AmbiguousEntryError,
    );
  });
});
