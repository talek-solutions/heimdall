import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { VertexType, type IComponentVertex, type SystemGraph } from '@heimdall/core/graph';
import { InteractionMode } from '@heimdall/core/manifest';
import { LLM_PROVIDER } from '@heimdall/llm';
import {
  TELEMETRY_SOURCE_INTERCEPTOR,
  TelemetryEnvVariable,
  TelemetryOperation,
  type ITelemetryCall,
  type ITelemetrySourceInterceptor,
} from '@heimdall/telemetry';
import { loadGraph, ReferenceManifest } from '../__fixtures__/investigation.fixture';
import { HopSide } from '../enums';
import type { IInvestigationPlan } from '../interfaces';
import { InvestigationModule } from '../investigation.module';
import { CheckRunner } from './checks/check.runner';
import { EvidenceRunner } from './evidence/evidence.runner';
import { ExecutionSession } from './execution.session';
import { TelemetrySourcesResolver } from './sources/telemetry-sources.resolver';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const ENV = {
  [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
  [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
  [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
  [TelemetryEnvVariable.FixtureScenario]: 'increased-latency-1',
  [TelemetryEnvVariable.FixtureAnchor]: ANCHOR,
};
const END = new Date(ANCHOR);
const WINDOW = { start: new Date(END.getTime() - 60 * 60_000), end: END };
const signal = new AbortController().signal;

class Watching implements ITelemetrySourceInterceptor {
  readonly calls: ITelemetryCall[] = [];

  intercept<T>(call: ITelemetryCall, run: () => Promise<T>): Promise<T> {
    this.calls.push(call);
    return run();
  }
}

async function runners(): Promise<{
  readonly watching: Watching;
  readonly checks: CheckRunner;
  readonly evidence: EvidenceRunner;
  readonly session: ExecutionSession;
  readonly graph: SystemGraph;
  readonly component: (name: string) => IComponentVertex;
}> {
  const watching = new Watching();

  @Global()
  @Module({
    providers: [{ provide: TELEMETRY_SOURCE_INTERCEPTOR, useValue: watching }],
    exports: [TELEMETRY_SOURCE_INTERCEPTOR],
  })
  class WatchingModule {}

  Object.assign(process.env, ENV);
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      WatchingModule,
      InvestigationModule,
    ],
  })
    .overrideProvider(LLM_PROVIDER)
    .useValue({})
    .compile();
  const graph = await loadGraph(ReferenceManifest.Checkout);

  return {
    watching,
    checks: moduleRef.get(CheckRunner),
    evidence: moduleRef.get(EvidenceRunner),
    session: new ExecutionSession(
      graph,
      { checks: [] } as unknown as IInvestigationPlan,
      moduleRef.get(TelemetrySourcesResolver).resolve(undefined),
      {},
    ),
    graph,
    component: (name) => {
      const vertex = graph.vertexOfType(`component:${name}`, VertexType.Component);

      assert.ok(vertex);
      return vertex;
    },
  };
}

function operations(calls: readonly ITelemetryCall[]): TelemetryOperation[] {
  return [...new Set(calls.map(({ operation }) => operation))].sort();
}

describe('Every source call names the result it serves (ADR 0020)', () => {
  after(() => {
    for (const name of Object.keys(ENV)) {
      delete process.env[name];
    }
  });

  it('an indicator check: each role is a result, and its window and baseline queries name it', async () => {
    const { watching, checks, session, graph } = await runners();
    const indicator = graph
      .indicatorsOf('component:checkout')
      .find(({ roles }) => roles.length > 1);

    assert.ok(indicator, 'the reference manifest has an indicator with several roles');
    const { results, queries } = await checks.run(
      session,
      { check: null, indicator, roles: indicator.roles },
      WINDOW,
      signal,
    );

    assert.equal(results.length, indicator.roles.length);
    assert.equal(watching.calls.length, queries);
    assert.deepEqual(operations(watching.calls), [TelemetryOperation.MetricsQueryRange]);
    for (const { result } of results) {
      assert.equal(
        watching.calls.filter(({ resultIds }) => resultIds?.join() === result).length,
        2,
        result,
      );
    }
  });

  it('a logs result: every slice and every confirmation query names it', async () => {
    const { watching, evidence, session, component } = await runners();
    const { result, queries } = await evidence.logs(
      session,
      { check: null, component: component('orders-pg') },
      WINDOW,
      signal,
    );

    assert.equal(watching.calls.length, queries);
    assert.ok(queries > 2, 'the worked example confirms new templates');
    assert.deepEqual(operations(watching.calls), [TelemetryOperation.LogsQueryRange]);
    assert.ok(watching.calls.every(({ resultIds }) => resultIds?.join() === result.result));
  });

  it('a traces result: the searches and the exemplar fetch name it', async () => {
    const { watching, evidence, session, component } = await runners();
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

    assert.equal(watching.calls.length, queries);
    assert.notEqual(result.exemplar, null);
    assert.deepEqual(operations(watching.calls), [
      TelemetryOperation.TracesSearch,
      TelemetryOperation.TracesTrace,
    ]);
    assert.ok(watching.calls.every(({ resultIds }) => resultIds?.join() === result.result));
  });

  it('a single trace: its fetch names it, and two results in one session never share a call', async () => {
    const { watching, evidence, session, component } = await runners();
    const searched = await evidence.traces(
      session,
      { check: null, component: component('checkout'), errorsOnly: true },
      WINDOW,
      signal,
    );
    const before = watching.calls.length;
    const fetched = await evidence.trace(session, searched.result.exemplar?.traceId ?? '', signal);
    const fetches = watching.calls.slice(before);

    assert.notEqual(searched.result.exemplar, null);
    assert.notEqual(fetched.result.result, searched.result.result);
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0]?.operation, TelemetryOperation.TracesTrace);
    assert.deepEqual(fetches[0]?.resultIds, [fetched.result.result]);
    assert.ok(
      watching.calls
        .slice(0, before)
        .every(({ resultIds }) => resultIds?.join() === searched.result.result),
    );
  });
});
