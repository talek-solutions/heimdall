import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { AuthScheme } from '@heimdall/config';
import { VertexType, type IIndicatorVertex, type SystemGraph } from '@heimdall/core/graph';
import { IndicatorRole } from '@heimdall/core/manifest';
import {
  MetricsSource,
  TelemetryEnvVariable,
  TelemetrySourceModule,
  type IConnectorSource,
} from '@heimdall/telemetry';
import { loadGraph, ReferenceManifest } from '../../__fixtures__/investigation.fixture';
import { InvestigationErrorCode } from '../../errors';
import { PromQlCompiler, type ICompiledQuery } from './promql.compiler';

const compiler = new PromQlCompiler();
const ANCHOR = '2026-10-17T08:00:00.000Z';
const SOURCE: IConnectorSource = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 1_000,
  auth: { scheme: AuthScheme.None },
};

function indicator(graph: SystemGraph, subject: string, metric?: string): IIndicatorVertex {
  const found = graph
    .indicatorsOf(subject)
    .find((candidate) => metric === undefined || candidate.metric === metric);

  assert.ok(found, `${subject} has an indicator on ${metric ?? 'any metric'}`);
  return found;
}

function compiled(
  graph: SystemGraph,
  vertex: IIndicatorVertex,
  role: IndicatorRole,
): ICompiledQuery {
  const result = compiler.compile(graph, vertex, role, {}, 60);

  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.compiled;
}

describe('PromQlCompiler on the checkout manifest', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Checkout);
  });

  it('builds the error ratio of a step, status matcher first, narrowed by the step match', () => {
    const step = indicator(graph, 'step:place-order#1');

    assert.equal(
      compiled(graph, step, IndicatorRole.Errors).query,
      'sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5..",service="checkout",http_route="/api/checkout",http_request_method="POST"}[60s])) / sum(rate(http_server_request_duration_seconds_count{service="checkout",http_route="/api/checkout",http_request_method="POST"}[60s]))',
    );
  });

  it('counts only successful requests for a KPI, and every request for throughput', () => {
    const kpi = indicator(graph, 'functionality:checkout');
    const step = indicator(graph, 'step:place-order#1');

    assert.equal(
      compiled(graph, kpi, IndicatorRole.Kpi).query,
      'sum(rate(http_server_request_duration_seconds_count{http_response_status_code!~"5..",service="checkout"}[60s]))',
    );
    assert.equal(
      compiled(graph, step, IndicatorRole.Throughput).query,
      'sum(rate(http_server_request_duration_seconds_count{service="checkout",http_route="/api/checkout",http_request_method="POST"}[60s]))',
    );
  });

  it('computes the SLO percentile for latency, p99 otherwise', () => {
    const flow = indicator(graph, 'flow:place-order');
    const latency = compiled(graph, flow, IndicatorRole.Latency);

    assert.equal(
      latency.query,
      'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout"}[60s])))',
    );
    assert.equal(latency.quantile, 0.99);
    assert.equal(latency.unit, 'seconds');
  });

  it('takes the worst instance of a saturation gauge', () => {
    const lockCount = indicator(graph, 'component:orders-pg', 'orders-pg/pg_locks_count');

    assert.equal(
      compiled(graph, lockCount, IndicatorRole.Saturation).query,
      'max(pg_locks_count{datname="orders"})',
    );
  });

  it('locates the provider through its caller, whose client metric it is', () => {
    const step = indicator(graph, 'step:place-order#5');

    assert.match(
      compiled(graph, step, IndicatorRole.Errors).query,
      /^sum\(rate\(http_client_request_duration_seconds_count\{http_response_status_code=~"5\.\.",service="payments",http_request_method="POST"\}/,
    );
  });

  it('refuses a template the metric type cannot answer', () => {
    const pool = indicator(graph, 'component:checkout', 'checkout/db_client_connections_usage');
    const result = compiler.compile(graph, pool, IndicatorRole.Latency, {}, 60);

    assert.equal(result.ok, true, 'a gauge reads its value for latency');
    const counter = compiler.compile(
      graph,
      indicator(graph, 'step:place-order#3'),
      IndicatorRole.Saturation,
      {},
      60,
    );
    assert.deepEqual(
      counter.ok ? undefined : counter.errorCode,
      InvestigationErrorCode.NoQueryTemplate,
    );
  });

  it('adds the environment labels to every selector', () => {
    const query = compiler.compile(
      graph,
      indicator(graph, 'functionality:checkout'),
      IndicatorRole.Kpi,
      { env: 'prod' },
      60,
    );

    assert.ok(query.ok && query.compiled.query.includes('service="checkout",env="prod"'));
  });
});

describe('PromQlCompiler on the shop manifest', () => {
  it('narrows a member indicator to its member, and fails an owner with no metrics identity', async () => {
    const graph = await loadGraph(ReferenceManifest.Shop);
    const lag = indicator(graph, 'member:mysql-main/replica-1');
    const browserErrors = indicator(graph, 'component:frontend');
    const replica = compiler.compile(graph, lag, IndicatorRole.Lag, {}, 60);
    const frontend = compiler.compile(graph, browserErrors, IndicatorRole.Errors, {}, 60);

    assert.ok(replica.ok);
    assert.equal(
      replica.compiled.query,
      'max(mysql_replica_lag_seconds{job="mysql-exporter",instance="mysql-1:9104"})',
    );
    assert.equal(
      frontend.ok ? undefined : frontend.errorCode,
      InvestigationErrorCode.NoMetricsIdentity,
    );
    assert.equal(graph.vertexOfType('component:frontend', VertexType.Component)?.name, 'frontend');
  });
});

describe('Compiled queries reach the error-burst-30s fixture', () => {
  let graph: SystemGraph;
  let metrics: MetricsSource;

  before(async () => {
    process.env[TelemetryEnvVariable.PrometheusDatasourceType] = 'fixture';
    process.env[TelemetryEnvVariable.FixtureScenario] = 'error-burst-30s';
    process.env[TelemetryEnvVariable.FixtureAnchor] = ANCHOR;
    graph = await loadGraph(ReferenceManifest.Checkout);
    metrics = (await Test.createTestingModule({ imports: [TelemetrySourceModule] }).compile()).get(
      MetricsSource,
    );
  });

  after(() => {
    delete process.env[TelemetryEnvVariable.PrometheusDatasourceType];
    delete process.env[TelemetryEnvVariable.FixtureScenario];
    delete process.env[TelemetryEnvVariable.FixtureAnchor];
  });

  const cases: Array<[string, string | undefined, IndicatorRole]> = [
    ['functionality:checkout', undefined, IndicatorRole.Kpi],
    ['flow:place-order', undefined, IndicatorRole.Latency],
    ['step:place-order#1', undefined, IndicatorRole.Errors],
    ['step:place-order#1', undefined, IndicatorRole.Throughput],
    ['step:place-order#4', undefined, IndicatorRole.Errors],
    ['step:place-order#5', undefined, IndicatorRole.Errors],
    ['component:payments', undefined, IndicatorRole.Latency],
  ];

  for (const [subject, metric, role] of cases) {
    it(`${subject} ${role} returns exactly one series`, async () => {
      const query = compiled(graph, indicator(graph, subject, metric), role);
      const series = await metrics.queryRange(SOURCE, {
        query: query.query,
        start: new Date(Date.parse(ANCHOR) - 60_000),
        end: new Date(ANCHOR),
        stepSeconds: 1,
        labels: query.labels,
      });

      assert.equal(series.length, 1, query.query);
    });
  }
});
