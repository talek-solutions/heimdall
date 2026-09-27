import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  dependencyV1,
  manifestV1,
  metricV1,
  runRule,
  systemV1,
} from '../../__fixtures__/manifest-v1.fixture';
import { MemberRole, TopologyMode } from '../../enums';
import { UniqueNamesRule } from './unique-names.rule';

const rule = new UniqueNamesRule();

describe('UniqueNamesRule', () => {
  it('accepts distinct names', () => {
    const api = componentV1('api', {
      dependsOn: [dependencyV1('db', 'mysql'), dependencyV1('cache', 'redis')],
      metrics: [metricV1('a_total'), metricV1('b_total')],
    });

    assert.deepEqual(runRule(rule, manifestV1({ components: [api] })), []);
  });

  it('rejects a duplicate dependency, metric and member within a component', () => {
    const api = componentV1('api', {
      dependsOn: [dependencyV1('db', 'mysql'), dependencyV1('db', 'postgres')],
      metrics: [metricV1('a_total'), metricV1('a_total')],
      topology: {
        mode: TopologyMode.Cluster,
        members: [
          { name: 'node-1', role: MemberRole.Node, telemetry: {}, indicators: [] },
          { name: 'node-1', role: MemberRole.Node, telemetry: {}, indicators: [] },
        ],
      },
    });

    assert.deepEqual(
      runRule(rule, manifestV1({ components: [api] })).map(({ location }) => location),
      [
        'Component/api spec.dependsOn.1.name',
        'Component/api spec.metrics.1.name',
        'Component/api spec.topology.members.1.name',
      ],
    );
  });

  it('allows the same dependency name on different components', () => {
    const components = [
      componentV1('api', { dependsOn: [dependencyV1('db', 'mysql')] }),
      componentV1('worker', { dependsOn: [dependencyV1('db', 'mysql')] }),
    ];

    assert.deepEqual(runRule(rule, manifestV1({ components })), []);
  });

  it('rejects a duplicate environment', () => {
    const environment = { name: 'prod', context: 'prod', labels: {} };
    const system = systemV1({ environments: [environment, environment] });

    assert.deepEqual(runRule(rule, manifestV1({ system })), [
      {
        location: 'System/shop spec.environments.1.name',
        message: "duplicate environment name 'prod'",
      },
    ]);
  });
});
