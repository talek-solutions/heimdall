import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  flowV1,
  functionalityV1,
  indicatorV1,
  manifestV1,
  metricV1,
  runRule,
  stepV1,
} from '../../__fixtures__/manifest-v1.fixture';
import { MemberRole, TopologyMode } from '../../enums';
import type { IComponentV1 } from '../../interfaces/v1';
import { IndicatorReferencesRule } from './indicator-references.rule';

const rule = new IndicatorReferencesRule();

function db(indicators = [indicatorV1({ metric: 'lag_seconds' })]): IComponentV1 {
  return componentV1('db', {
    metrics: [metricV1('lag_seconds'), metricV1('used_bytes'), metricV1('max_bytes')],
    indicators,
    topology: {
      mode: TopologyMode.PrimaryReplica,
      members: [
        { name: 'primary', role: MemberRole.Primary, telemetry: {}, indicators: [] },
        {
          name: 'replica-1',
          role: MemberRole.Replica,
          telemetry: {},
          indicators: [indicatorV1({ metric: 'lag_seconds' })],
        },
      ],
    },
  });
}

describe('IndicatorReferencesRule', () => {
  it('resolves local names on components and members, and qualified names anywhere', () => {
    const manifest = manifestV1({
      components: [
        db([indicatorV1({ ratio: { numerator: 'used_bytes', denominator: 'db/max_bytes' } })]),
      ],
      functionalities: [
        functionalityV1('ordering', { indicators: [indicatorV1({ metric: 'db/lag_seconds' })] }),
      ],
      flows: [
        flowV1('submit', {
          indicators: [indicatorV1({ metric: 'db/lag_seconds' })],
          steps: [stepV1('db/x', { indicators: [indicatorV1({ metric: 'db/used_bytes' })] })],
        }),
      ],
    });

    assert.deepEqual(runRule(rule, manifest), []);
  });

  it('requires component/metric where nothing owns the indicator', () => {
    const manifest = manifestV1({
      components: [db()],
      functionalities: [
        functionalityV1('ordering', { indicators: [indicatorV1({ metric: 'lag_seconds' })] }),
      ],
    });

    assert.deepEqual(runRule(rule, manifest), [
      {
        location: 'Functionality/ordering spec.indicators.0.metric',
        message:
          "'lag_seconds' must name its component as component/metric; nothing owns this indicator",
      },
    ]);
  });

  it('rejects an unknown metric on a member, listing the component’s metrics', () => {
    const component = db();
    const broken: IComponentV1 = {
      ...component,
      spec: {
        ...component.spec,
        topology: {
          mode: TopologyMode.Cluster,
          members: [
            {
              name: 'node-1',
              role: MemberRole.Shard,
              telemetry: {},
              indicators: [indicatorV1({ metric: 'lag' })],
            },
          ],
        },
      },
    };

    assert.deepEqual(runRule(rule, manifestV1({ components: [broken] })), [
      {
        location: 'Component/db spec.topology.members.0.indicators.0.metric',
        message: "db declares no metric 'lag'; its metrics are lag_seconds, used_bytes, max_bytes",
      },
    ]);
  });

  it('checks both parts of a ratio on a step', () => {
    const manifest = manifestV1({
      components: [db()],
      flows: [
        flowV1('submit', {
          steps: [
            stepV1('db/x', {
              indicators: [
                indicatorV1({
                  ratio: { numerator: 'db/used_bytes', denominator: 'cache/max_bytes' },
                }),
              ],
            }),
          ],
        }),
      ],
    });

    assert.deepEqual(runRule(rule, manifest), [
      {
        location: 'Flow/submit spec.steps.0.indicators.0.ratio.denominator',
        message: "unknown component 'cache'; declared components are db",
      },
    ]);
  });
});
