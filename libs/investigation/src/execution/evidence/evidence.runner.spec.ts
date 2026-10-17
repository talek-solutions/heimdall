import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { VertexType, type IComponentVertex, type SystemGraph } from '@heimdall/core/graph';
import { InteractionMode } from '@heimdall/core/manifest';
import { LLM_PROVIDER } from '@heimdall/llm';
import { TelemetryEnvVariable } from '@heimdall/telemetry';
import { loadGraph, ReferenceManifest } from '../../__fixtures__/investigation.fixture';
import { HopSide } from '../../enums';
import type { IInvestigationPlan } from '../../interfaces';
import { InvestigationModule } from '../../investigation.module';
import { ExecutionSession } from '../execution.session';
import { TelemetrySourcesResolver } from '../sources/telemetry-sources.resolver';
import { OperationChange } from './evidence.enums';
import { EvidenceRunner } from './evidence.runner';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const ENV = {
  [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
  [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
  [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
  [TelemetryEnvVariable.FixtureAnchor]: ANCHOR,
};
const END = new Date(ANCHOR);
const WINDOW = { start: new Date(END.getTime() - 60 * 60_000), end: END };
const signal = new AbortController().signal;

async function runner(scenario: string): Promise<{
  readonly evidence: EvidenceRunner;
  readonly session: ExecutionSession;
  readonly component: (name: string) => IComponentVertex;
}> {
  for (const [name, value] of Object.entries({
    ...ENV,
    [TelemetryEnvVariable.FixtureScenario]: scenario,
  })) {
    process.env[name] = value;
  }
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), InvestigationModule],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue({})
    .compile();
  const graph: SystemGraph = await loadGraph(ReferenceManifest.Checkout);
  const plan = { checks: [] } as unknown as IInvestigationPlan;

  return {
    evidence: moduleRef.get(EvidenceRunner),
    session: new ExecutionSession(
      graph,
      plan,
      moduleRef.get(TelemetrySourcesResolver).resolve(undefined),
      {},
    ),
    component: (name) => {
      const vertex = graph.vertexOfType(`component:${name}`, VertexType.Component);
      assert.ok(vertex);
      return vertex;
    },
  };
}

/** `.docs/design/log-and-trace-evidence.md`, Worked example, row for row. */
describe('EvidenceRunner on increased-latency-1 (log-and-trace-evidence.md, Worked example)', () => {
  after(() => {
    for (const name of [...Object.keys(ENV), TelemetryEnvVariable.FixtureScenario]) {
      delete process.env[name];
    }
  });

  it('orders-pg: four new lock and timeout templates, from 11 queries', async () => {
    const { evidence, session, component } = await runner('increased-latency-1');
    const { result, queries } = await evidence.logs(
      session,
      { check: null, component: component('orders-pg') },
      WINDOW,
      signal,
    );

    assert.deepEqual(
      result.templates.new.map(({ template, count, confirmedAbsent }) => [
        template,
        count.window,
        confirmedAbsent,
      ]),
      [
        ['LOG: process <*> still waiting for ShareLock on transaction <*> after <*> ms', 261, true],
        ['DETAIL: Process holding the lock: <*> Wait queue: <*>', 169, true],
        [
          'LOG: duration: <*> ms statement: UPDATE orders SET status = <*> updated_at = now() WHERE id = <*>',
          167,
          true,
        ],
        ['ERROR: canceling statement due to statement timeout', 42, null],
      ],
    );
    assert.match(
      result.templates.new[1]?.examples[0]?.fields['message'] ?? '',
      /holding the lock: 47102/,
    );
    assert.deepEqual(result.sampled, { window: 1000, baseline: 1000, slices: 4, capped: true });
    assert.equal(queries, 11);
  });

  it('checkout around the orders-db hop: four new templates, and the secret-bearing fields dropped', async () => {
    const { evidence, session, component } = await runner('increased-latency-1');
    const { result } = await evidence.logs(
      session,
      {
        check: null,
        component: component('checkout'),
        match: { operation: 'UPDATE', table: 'orders' },
      },
      WINDOW,
      signal,
    );
    const dropped = session.droppedFields.find(({ subject }) => subject === 'component:checkout');

    assert.deepEqual(
      result.templates.new.map(({ template, count }) => [template, count.window]),
      [
        ['slow query', 102],
        ['request failed', 55],
        ['connection pool usage high', 50],
        ['acquire connection timeout', 36],
      ],
    );
    assert.deepEqual(result.filter.narrowedBy, { operation: 'UPDATE', table: 'orders' });
    for (const name of ['authorization', 'customer', 'dsn']) {
      assert.ok(dropped?.fields.includes(name), name);
    }
    assert.equal(JSON.stringify(result).includes('"customer"'), false);
  });

  it('orders-reconcile: a stream that only exists in the window, from 8 queries', async () => {
    const { evidence, session, component } = await runner('increased-latency-1');
    const { result, queries } = await evidence.logs(
      session,
      { check: null, component: component('orders-reconcile') },
      WINDOW,
      signal,
    );

    assert.equal(result.streamNew, true);
    assert.deepEqual(
      result.templates.new.map(({ template, count }) => [template, count.window]),
      [
        ['reconciling batch', 396],
        ['upstream ledger page fetched', 216],
      ],
    );
    assert.deepEqual(Object.keys(result.templates.new[0]?.examples[0]?.fields ?? {}).sort(), [
      'isolation',
      'message',
      'severity',
      'table',
      'txOpenSeconds',
    ]);
    assert.deepEqual(
      result.templates.new[0]?.examples.map(({ fields }) => fields['txOpenSeconds']),
      ['1', '2037'],
      'the transaction has been open for 34 minutes by the last line',
    );
    assert.equal(queries, 8);
  });

  it("checkout's client spans to orders-pg: UPDATE orders slower, with the pool timeout in the exemplar", async () => {
    const { evidence, session, component } = await runner('increased-latency-1');
    const { result, queries } = await evidence.traces(
      session,
      {
        check: null,
        component: component('checkout'),
        hop: { side: HopSide.Caller, mode: InteractionMode.Sync },
        match: { operation: 'UPDATE', table: 'orders' },
        errorsOnly: false,
      },
      WINDOW,
      signal,
    );
    const [update] = result.operations;

    assert.equal(update?.name, 'UPDATE orders');
    assert.deepEqual(update?.changes, [OperationChange.Slower]);
    assert.deepEqual(update?.durationMs.p50, { window: 65, baseline: 8 });
    assert.deepEqual(update?.errorTypes, ['PoolTimeoutError']);
    assert.match(
      result.exemplar?.spans.find(({ name }) => name === 'UPDATE orders')?.message ?? '',
      /pool exhausted/,
    );
    assert.equal(JSON.stringify(result).includes('updated_at = now()'), false, 'no statement text');
    assert.equal(queries, 7);
  });

  it('healthy-baseline: nothing new, surging or vanished', async () => {
    const { evidence, session, component } = await runner('healthy-baseline');

    for (const name of ['orders-pg', 'checkout']) {
      const { result } = await evidence.logs(
        session,
        { check: null, component: component(name) },
        WINDOW,
        signal,
      );
      const { templates } = result;

      assert.equal(
        templates.new.length + templates.surging.length + templates.vanished.length,
        0,
        name,
      );
    }
  });
});
