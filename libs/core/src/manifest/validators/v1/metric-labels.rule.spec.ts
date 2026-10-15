import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { componentV1, manifestV1, metricV1, runRule } from '../../__fixtures__/manifest-v1.fixture';
import { LabelSemantic } from '../../enums';
import { MetricLabelsRule } from './metric-labels.rule';

const rule = new MetricLabelsRule();

describe('MetricLabelsRule', () => {
  it('accepts labels that each mean something different', () => {
    const api = componentV1('api', {
      metrics: [
        metricV1('http_seconds', {
          labels: { route: LabelSemantic.Route, code: LabelSemantic.StatusCode },
        }),
      ],
    });

    assert.deepEqual(runRule(rule, manifestV1({ components: [api] })), []);
  });

  it('rejects labels sharing a meaning, since a selector on it could not pick one', () => {
    const api = componentV1('api', {
      metrics: [
        metricV1('plain_total'),
        metricV1('http_seconds', {
          labels: {
            http_route: LabelSemantic.Route,
            code: LabelSemantic.StatusCode,
            path: LabelSemantic.Route,
          },
        }),
      ],
    });

    assert.deepEqual(runRule(rule, manifestV1({ components: [api] })), [
      {
        location: 'Component/api spec.metrics.1.labels',
        message:
          'labels http_route, path share the meaning route; a selector on route needs exactly one label',
      },
    ]);
  });
});
