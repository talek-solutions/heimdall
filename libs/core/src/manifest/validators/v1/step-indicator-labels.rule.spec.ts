import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  flowV1,
  indicatorV1,
  manifestV1,
  metricV1,
  runRule,
  stepV1,
} from '../../__fixtures__/manifest-v1.fixture';
import { LabelSemantic } from '../../enums';
import type { IIndicatorV1, IManifestV1 } from '../../interfaces/v1';
import { StepIndicatorLabelsRule } from './step-indicator-labels.rule';

const rule = new StepIndicatorLabelsRule();

const api = componentV1('api', {
  metrics: [
    metricV1('http_seconds', {
      labels: {
        http_route: LabelSemantic.Route,
        http_method: LabelSemantic.Method,
        code: LabelSemantic.StatusCode,
      },
    }),
    metricV1('http_total', { labels: { http_route: LabelSemantic.Route } }),
    metricV1('pool_in_use'),
  ],
});

function submit(indicators: readonly IIndicatorV1[]): IManifestV1 {
  return manifestV1({
    components: [api],
    flows: [
      flowV1('submit', {
        steps: [
          stepV1('web/api', {
            match: { [LabelSemantic.Route]: '/orders', [LabelSemantic.Method]: 'POST' },
            indicators,
          }),
        ],
      }),
    ],
  });
}

describe('StepIndicatorLabelsRule', () => {
  it('accepts metrics labelling every meaning the step matches on, and own queries', () => {
    const manifest = submit([
      indicatorV1({ metric: 'api/http_seconds' }),
      indicatorV1({ metric: 'api/pool_in_use', query: 'sum(pool_in_use{job="api"})' }),
    ]);

    assert.deepEqual(runRule(rule, manifest), []);
  });

  it('rejects a metric with no label for a meaning the step matches on', () => {
    const manifest = submit([
      indicatorV1({ metric: 'api/http_seconds' }),
      indicatorV1({ metric: 'api/pool_in_use' }),
    ]);

    assert.deepEqual(runRule(rule, manifest), [
      {
        location: 'Flow/submit spec.steps.0.indicators.1.metric',
        message:
          'api/pool_in_use has no label meaning route, method, which the step matches on; label the metric or give the indicator a query',
      },
    ]);
  });

  it('checks each side of a ratio', () => {
    const manifest = submit([
      indicatorV1({ ratio: { numerator: 'api/http_seconds', denominator: 'api/http_total' } }),
    ]);

    assert.deepEqual(runRule(rule, manifest), [
      {
        location: 'Flow/submit spec.steps.0.indicators.0.ratio.denominator',
        message:
          'api/http_total has no label meaning method, which the step matches on; label the metric or give the indicator a query',
      },
    ]);
  });

  it('leaves metrics that do not resolve to IndicatorReferencesRule', () => {
    const manifest = submit([
      indicatorV1({ metric: 'api/unknown_total' }),
      indicatorV1({ metric: 'http_seconds' }),
    ]);

    assert.deepEqual(runRule(rule, manifest), []);
  });
});
