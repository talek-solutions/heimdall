import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  dependencyV1,
  manifestV1,
  metricV1,
  runRule,
} from '../../__fixtures__/manifest-v1.fixture';
import { Transport } from '../../enums';
import { MetricMeasuresRule } from './metric-measures.rule';

const rule = new MetricMeasuresRule();

describe('MetricMeasuresRule', () => {
  it('accepts an outbound dependency of the same component and an exposed transport', () => {
    const api = componentV1('api', {
      exposes: [{ transport: Transport.Http }],
      dependsOn: [dependencyV1('db', 'mysql')],
      metrics: [
        metricV1('db_seconds', { measures: { outbound: 'db' } }),
        metricV1('http_seconds', { measures: { inbound: Transport.Http } }),
        metricV1('plain_total'),
      ],
    });

    assert.deepEqual(runRule(rule, manifestV1({ components: [api] })), []);
  });

  it('rejects an outbound measure naming another component’s dependency', () => {
    const components = [
      componentV1('api', { metrics: [metricV1('db_seconds', { measures: { outbound: 'db' } })] }),
      componentV1('worker', { dependsOn: [dependencyV1('db', 'mysql')] }),
    ];

    assert.deepEqual(runRule(rule, manifestV1({ components })), [
      {
        location: 'Component/api spec.metrics.0.measures.outbound',
        message: "'db' is not a dependency of api; its dependencies are (none)",
      },
    ]);
  });

  it('rejects an inbound measure over a transport the component does not expose', () => {
    const api = componentV1('api', {
      exposes: [{ transport: Transport.Http }],
      metrics: [metricV1('ws_total', { measures: { inbound: Transport.Websocket } })],
    });

    assert.deepEqual(runRule(rule, manifestV1({ components: [api] })), [
      {
        location: 'Component/api spec.metrics.0.measures.inbound',
        message: 'api does not expose websocket; it exposes http',
      },
    ]);
  });
});
