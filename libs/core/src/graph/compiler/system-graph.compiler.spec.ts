import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  componentV1,
  indicatorV1,
  manifestV1,
  metricV1,
} from '../../manifest/__fixtures__/manifest-v1.fixture';
import { IndicatorRole, LabelSemantic, MetricType, Transport } from '../../manifest/enums';
import {
  compileReferenceManifest,
  ReferenceManifest,
} from '../__fixtures__/reference-manifests.fixture';
import { EdgeType, IndicatorProvenance, VertexType } from '../enums';
import type { SystemGraph } from '../system-graph';
import { SystemGraphCompiler } from './system-graph.compiler';

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  }
  return counts;
}

describe('SystemGraphCompiler on the shop reference manifest', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await compileReferenceManifest(ReferenceManifest.Shop);
  });

  it('compiles the 58 vertices and 71 edges documented in its README', () => {
    assert.equal(graph.vertices.length, 58);
    assert.equal(graph.edges.length, 71);
    assert.deepEqual(
      countBy(graph.vertices, (vertex) => vertex.type),
      {
        [VertexType.Functionality]: 2,
        [VertexType.Flow]: 3,
        [VertexType.Step]: 7,
        [VertexType.Dependency]: 8,
        [VertexType.Component]: 6,
        [VertexType.Member]: 6,
        [VertexType.Indicator]: 26,
      },
    );
    assert.deepEqual(
      countBy(graph.edges, (edge) => edge.type),
      {
        [EdgeType.RealizedBy]: 3,
        [EdgeType.HasStep]: 7,
        [EdgeType.Next]: 4,
        [EdgeType.Over]: 7,
        [EdgeType.Calls]: 8,
        [EdgeType.Targets]: 8,
        [EdgeType.MemberOf]: 6,
        [EdgeType.ReplicatesTo]: 2,
        [EdgeType.Measures]: 26,
      },
    );
  });

  it('declares 12 indicators and derives 14', () => {
    assert.deepEqual(
      countBy(graph.ofType(VertexType.Indicator), (indicator) => indicator.provenance),
      { [IndicatorProvenance.Declared]: 12, [IndicatorProvenance.Derived]: 14 },
    );
  });

  it('derives a step indicator from the target inbound metric, narrowed by the step match', () => {
    const [indicator] = graph.indicatorsOf('step:submit-order#1');

    assert.equal(indicator?.metric, 'services-2/http_server_requests_seconds');
    assert.deepEqual(indicator?.roles, [
      IndicatorRole.Throughput,
      IndicatorRole.Errors,
      IndicatorRole.Latency,
    ]);
    assert.deepEqual(indicator?.selector, { route: '/orders', method: 'POST' });
    assert.equal(indicator?.provenance, IndicatorProvenance.Derived);
  });

  it('keeps a declared step indicator next to one derived from the caller', () => {
    const metrics = graph.indicatorsOf('step:fulfil-order#1').map((indicator) => indicator.metric);

    assert.deepEqual(metrics, [
      'kafka/kafka_consumergroup_lag',
      'services-3/kafka_consumer_records_total',
    ]);
  });

  it('qualifies bare metric names with the owning component', () => {
    const [lag] = graph.indicatorsOf('member:mysql-main/replica-1');
    const [, ratio] = graph.indicatorsOf('functionality:ordering');

    assert.equal(lag?.metric, 'mysql-main/mysql_replica_lag_seconds');
    assert.deepEqual(ratio?.ratio, {
      numerator: 'services-3/orders_fulfilled_total',
      denominator: 'services-2/orders_created_total',
    });
  });

  it('links a primary to each of its replicas', () => {
    assert.deepEqual(
      graph.outgoing('member:mysql-main/primary', EdgeType.ReplicatesTo).map((edge) => edge.to),
      ['member:mysql-main/replica-1', 'member:mysql-main/replica-2'],
    );
  });
});

describe('SystemGraphCompiler indicator derivation', () => {
  const compiler = new SystemGraphCompiler();

  it('lets a declared indicator suppress the derived one for the same subject and metric', () => {
    const manifest = manifestV1({
      components: [
        componentV1('api', {
          exposes: [{ transport: Transport.Http }],
          metrics: [
            metricV1('requests_total', {
              measures: { inbound: Transport.Http },
              labels: { code: LabelSemantic.StatusCode },
            }),
          ],
          indicators: [indicatorV1({ metric: 'requests_total', role: IndicatorRole.Errors })],
        }),
      ],
    });
    const indicators = compiler.compile(manifest).indicatorsOf('component:api');

    assert.equal(indicators.length, 1);
    assert.equal(indicators[0]?.provenance, IndicatorProvenance.Declared);
  });

  it('derives nothing from a gauge without a role', () => {
    const manifest = manifestV1({
      components: [
        componentV1('db', {
          metrics: [metricV1('connections', { type: MetricType.Gauge, measures: undefined })],
        }),
      ],
    });

    assert.deepEqual(compiler.compile(manifest).indicatorsOf('component:db'), []);
  });
});

describe('SystemGraphCompiler on the checkout reference manifest', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await compileReferenceManifest(ReferenceManifest.Checkout);
  });

  it('derives an indicator for every step of place-order', () => {
    const steps = graph.path('flow:place-order')[0]?.steps ?? [];

    assert.equal(steps.length, 5);
    for (const step of steps) {
      assert.notEqual(graph.indicatorsOf(step.id).length, 0, step.id);
    }
  });

  it('observes the payment provider only through the caller', () => {
    const [indicator] = graph.indicatorsOf('step:place-order#5');

    assert.equal(indicator?.metric, 'payments/http_client_request_duration_seconds');
    assert.deepEqual(graph.indicatorsOf('component:payment-provider'), []);
  });
});
