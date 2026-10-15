import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LabelSemantic, MetricType } from '../manifest/enums';
import type { IMetricDefinition } from './interfaces';
import { labelMatchers } from './metric-labels';

const histogram: IMetricDefinition = {
  reference: 'checkout/http_server_request_duration_seconds',
  component: 'checkout',
  name: 'http_server_request_duration_seconds',
  type: MetricType.Histogram,
  unit: 'seconds',
  labels: {
    http_route: LabelSemantic.Route,
    http_request_method: LabelSemantic.Method,
    http_response_status_code: LabelSemantic.StatusCode,
  },
};

describe('labelMatchers', () => {
  it('names the label behind each meaning of the selector', () => {
    assert.deepEqual(
      labelMatchers(histogram, {
        [LabelSemantic.Route]: '/api/checkout',
        [LabelSemantic.Method]: 'POST',
      }),
      { http_route: '/api/checkout', http_request_method: 'POST' },
    );
  });

  it('needs no label for an empty selector', () => {
    assert.deepEqual(labelMatchers(histogram, {}), {});
  });

  it('returns undefined when the metric has no label for a meaning', () => {
    assert.equal(
      labelMatchers(histogram, {
        [LabelSemantic.Route]: '/api/checkout',
        [LabelSemantic.Table]: 'orders',
      }),
      undefined,
    );
  });
});
