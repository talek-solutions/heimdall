import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createReader,
  MINIMAL_MANIFEST,
  plain,
  readShopManifest,
} from '../../__fixtures__/manifest-v1.fixture';
import {
  ExpectationKind,
  IndicatorRole,
  LabelSemantic,
  ManifestProvenance,
  ReplicaRouting,
} from '../../enums';
import { ManifestError, ManifestErrorCode } from '../../errors';

const reader = createReader();
const SHOP = readShopManifest();

function isInvalid(...fragments: string[]): (error: unknown) => boolean {
  return (error) =>
    error instanceof ManifestError &&
    error.errorCode === ManifestErrorCode.ManifestInvalid &&
    fragments.every((fragment) => error.message.includes(fragment));
}

describe('ManifestV1Parser: the shop reference manifest', async () => {
  const manifest = await reader.parse(SHOP);
  const component = (name: string) =>
    manifest.components.find((entry) => entry.metadata.name === name);

  it('parses every resource', () => {
    assert.equal(manifest.system.metadata.name, 'shop');
    assert.equal(manifest.components.length, 6);
    assert.equal(manifest.components.flatMap((entry) => entry.spec.dependsOn).length, 8);
    assert.deepEqual(
      manifest.functionalities.map((entry) => entry.metadata.name),
      ['ordering', 'order-tracking'],
    );
    assert.deepEqual(
      manifest.flows.map((entry) => entry.metadata.name),
      ['submit-order', 'fulfil-order', 'status-push'],
    );
  });

  it('keeps a replica member indicator with its threshold', () => {
    const replica = component('mysql-main')?.spec.topology?.members[1];

    assert.equal(replica?.name, 'replica-1');
    assert.deepEqual(plain(replica?.indicators[0]), {
      metric: 'mysql_replica_lag_seconds',
      role: IndicatorRole.Lag,
      expect: { kind: ExpectationKind.Threshold, max: 5 },
    });
  });

  it('keeps a ratio KPI with its SLO', () => {
    const kpi = manifest.functionalities[0]?.spec.indicators[1];

    assert.deepEqual(plain(kpi?.ratio), {
      numerator: 'services-3/orders_fulfilled_total',
      denominator: 'services-2/orders_created_total',
    });
    assert.deepEqual(plain(kpi?.expect), { kind: ExpectationKind.Slo, min: 0.99 });
  });

  it('keeps a percentile SLO on a flow', () => {
    assert.deepEqual(plain(manifest.flows[0]?.spec.indicators[0]?.expect), {
      kind: ExpectationKind.Slo,
      p95: 0.8,
    });
  });

  it('keeps dependency routing and label semantics', () => {
    const ordersDb = component('services-2')?.spec.dependsOn.find(
      (entry) => entry.name === 'orders-db',
    );
    const dbMetric = component('services-2')?.spec.metrics.find(
      (entry) => entry.name === 'db_client_seconds',
    );

    assert.equal(ordersDb?.writeTo, ReplicaRouting.Primary);
    assert.equal(ordersDb?.readFrom, ReplicaRouting.Replicas);
    assert.deepEqual(plain(ordersDb?.config), { poolSize: 20, timeoutMs: 2000 });
    assert.equal(dbMetric?.labels['outcome'], LabelSemantic.Outcome);
    assert.deepEqual(plain(dbMetric?.measures), { outbound: 'orders-db' });
  });

  it('applies defaults', () => {
    assert.equal(manifest.flows[0]?.spec.propagatesTraceContext, true);
    assert.equal(manifest.flows[1]?.spec.propagatesTraceContext, false);
    assert.equal(component('kafka')?.spec.dependsOn.length, 0);
    assert.equal(
      component('services-2')?.spec.dependsOn[0]?.provenance,
      ManifestProvenance.Declared,
    );
  });
});

describe('ManifestV1Parser: shape', () => {
  it('parses the minimal manifest, defaulting an expectation to baseline', async () => {
    const manifest = await reader.parse(MINIMAL_MANIFEST);

    assert.deepEqual(plain(manifest.components[0]?.spec.indicators[0]?.expect), {
      kind: ExpectationKind.Baseline,
    });
  });

  it('rejects an unknown key, located by document and resource', async () => {
    await assert.rejects(
      reader.parse(SHOP.replace('  engine: kafka\n', '  engine: kafka\n  engin: typo\n')),
      isInvalid('document 5 (Component/kafka) spec.engin: property engin should not exist'),
    );
  });

  it('rejects an unknown kind', async () => {
    await assert.rejects(
      reader.parse(
        SHOP.replace(
          'kind: Flow\nmetadata: { name: status-push',
          'kind: Pipeline\nmetadata: { name: status-push',
        ),
      ),
      isInvalid("document 12: kind 'Pipeline' is not supported"),
    );
  });

  it('rejects a value outside an enum', async () => {
    await assert.rejects(
      reader.parse(SHOP.replace('criticality: soft', 'criticality: sometimes')),
      isInvalid(
        'spec.dependsOn.1.criticality: criticality must be one of the following values: hard, soft',
      ),
    );
  });

  it('requires metadata.system on everything but the System', async () => {
    await assert.rejects(
      reader.parse(MINIMAL_MANIFEST.replace('{ name: api, system: shop }', '{ name: api }')),
      isInvalid('document 2 (Component/api) metadata.system'),
    );
  });

  it('rejects an indicator with both a metric and a ratio', async () => {
    await assert.rejects(
      reader.parse(
        SHOP.replace(
          '    - ratio: { numerator: redis_memory_used_bytes',
          '    - metric: redis_evicted_keys_total\n      ratio: { numerator: redis_memory_used_bytes',
        ),
      ),
      isInvalid('spec.indicators.0.metric|ratio: exactly one of metric, ratio must be set'),
    );
  });

  it('rejects an indicator with neither a metric nor a ratio', async () => {
    await assert.rejects(
      reader.parse(
        MINIMAL_MANIFEST.replace('{ metric: errors_total, role: errors }', '{ role: errors }'),
      ),
      isInvalid('spec.indicators.0.metric|ratio: exactly one of metric, ratio must be set'),
    );
  });

  it('rejects the joined key when a document sets it literally', async () => {
    await assert.rejects(
      reader.parse(
        MINIMAL_MANIFEST.replace(
          '{ metric: errors_total, role: errors }',
          '{ metric: errors_total, role: errors, "metric|ratio": 1 }',
        ),
      ),
      isInvalid('property metric|ratio should not exist'),
    );
  });

  it('rejects a threshold without bounds', async () => {
    await assert.rejects(
      reader.parse(
        SHOP.replace('expect: { kind: threshold, max: 1000 }', 'expect: { kind: threshold }'),
      ),
      isInvalid('spec.steps.0.indicators.0.expect.min|max: at least one of min, max must be set'),
    );
  });

  it('rejects an unknown expectation kind', async () => {
    await assert.rejects(
      reader.parse(
        SHOP.replace('expect: { kind: threshold, max: 1000 }', 'expect: { kind: roughly }'),
      ),
      isInvalid('expect.kind: kind must be one of the following values'),
    );
  });

  it('rejects a metric that measures both inbound and outbound', async () => {
    await assert.rejects(
      reader.parse(
        SHOP.replace(
          'measures: { inbound: http }',
          'measures: { inbound: http, outbound: orders-db }',
        ),
      ),
      isInvalid(
        'spec.metrics.0.measures.inbound|outbound: exactly one of inbound, outbound must be set',
      ),
    );
  });

  it('rejects a metric label meaning outside LabelSemantic', async () => {
    await assert.rejects(
      reader.parse(SHOP.replace('labels: { topic: topic }', 'labels: { topic: subject }')),
      isInvalid('labels must be a map of one of route, method'),
    );
  });

  it('rejects a step matching on a label meaning outside LabelSemantic', async () => {
    await assert.rejects(
      reader.parse(SHOP.replace('match: { route: /ws/orders }', 'match: { path: /ws/orders }')),
      isInvalid('document 12 (Flow/status-push) spec.steps.0.match'),
    );
  });

  it('accepts user-defined log field meanings, but only as camelCase names', async () => {
    await assert.rejects(
      reader.parse(SHOP.replace('order_id: orderId }', 'order_id: order-id }')),
      isInvalid('spec.telemetry.logs.fields'),
    );
  });

  it('rejects a flow without steps', async () => {
    await assert.rejects(
      reader.parse(
        `${MINIMAL_MANIFEST}---\napiVersion: heimdall/v1\nkind: Flow\nmetadata: { name: noop, system: shop }\nspec: { mode: sync, steps: [] }\n`,
      ),
      isInvalid('spec.steps: steps must contain at least 1 elements'),
    );
  });

  it('reports shape issues alone, not the broken references they would cause', async () => {
    const broken = SHOP.replace('criticality: soft', 'criticality: sometimes').replace(
      'target: kafka\n      transport: kafka\n      mode: async\n      criticality: hard\n      operations: [produce]',
      'target: kafkaa\n      transport: kafka\n      mode: async\n      criticality: hard\n      operations: [produce]',
    );

    await assert.rejects(
      reader.parse(broken),
      (error: unknown) =>
        isInvalid('criticality')(error) && !(error as Error).message.includes('kafkaa'),
    );
  });

  it('caps the number of reported issues', async () => {
    // 6 hard dependencies and 8 sync modes: 14 issues, 10 reported.
    const tooMany = SHOP.replaceAll('criticality: hard', 'criticality: firm').replaceAll(
      'mode: sync',
      'mode: blocking',
    );

    await assert.rejects(reader.parse(tooMany), isInvalid('(and 4 more)'));
  });
});

describe('ManifestV1Parser: references', () => {
  it('reports a broken reference by resource and field', async () => {
    await assert.rejects(
      reader.parse(SHOP.replace('flows: [status-push]', 'flows: [status-pull]')),
      isInvalid("Functionality/order-tracking spec.flows.0: unknown flow 'status-pull'"),
    );
  });

  it('reports assembly problems before reference problems', async () => {
    const broken = SHOP.replace(
      'metadata: { name: kafka, system: shop }',
      'metadata: { name: kafka, system: shoppe }',
    ).replace('flows: [status-push]', 'flows: [status-pull]');

    await assert.rejects(
      reader.parse(broken),
      (error: unknown) =>
        isInvalid("'shoppe' is not this manifest's system 'shop'")(error) &&
        !(error as Error).message.includes('status-pull'),
    );
  });
});
