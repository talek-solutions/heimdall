import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateMatrix,
  aggregateVector,
  BareAggregation,
  bareAggregation,
} from './bare-aggregation';

describe('bareAggregation', () => {
  it('recognises a sum or max around the whole query', () => {
    const cases: Array<[string, BareAggregation]> = [
      ['sum(rate(http_requests_total{service="checkout"}[1m]))', BareAggregation.Sum],
      ['  sum (rate(x[1m]))  ', BareAggregation.Sum],
      ['sum(rate(x{route="/a)b"}[1m]))', BareAggregation.Sum],
      ['max(pg_locks_count{datname="orders"})', BareAggregation.Max],
    ];

    for (const [query, expected] of cases) {
      assert.equal(bareAggregation(query), expected, query);
    }
  });

  it('leaves grouped aggregations, binary expressions and nested ones to routing', () => {
    for (const query of [
      'sum by (code) (rate(x[1m]))',
      'sum(rate(x[1m])) by (code)',
      'sum without (pod) (rate(x[1m]))',
      'max by (mode) (pg_locks_count)',
      'sum(rate(a[1m])) / sum(rate(b[1m]))',
      'histogram_quantile(0.99, sum by (le) (rate(x_bucket[1m])))',
      'min(x)',
    ]) {
      assert.equal(bareAggregation(query), undefined, query);
    }
  });
});

describe('aggregateMatrix and aggregateVector', () => {
  const matrix = [
    {
      metric: { code: '200' },
      values: [
        [1, '100'],
        [2, '110'],
      ] as [number, string][],
    },
    {
      metric: { code: '500' },
      values: [
        [1, '5'],
        [2, '7.5'],
      ] as [number, string][],
    },
  ];

  it('sum or take the max point by point, dropping every label', () => {
    assert.deepEqual(aggregateMatrix(BareAggregation.Sum, matrix), [
      {
        metric: {},
        values: [
          [1, '105'],
          [2, '117.5'],
        ],
      },
    ]);
    assert.deepEqual(aggregateMatrix(BareAggregation.Max, matrix), [
      {
        metric: {},
        values: [
          [1, '100'],
          [2, '110'],
        ],
      },
    ]);
    assert.deepEqual(
      aggregateVector(BareAggregation.Sum, [
        { metric: { code: '200' }, value: [1, '100'] },
        { metric: { code: '500' }, value: [1, '5'] },
      ]),
      [{ metric: {}, value: [1, '105'] }],
    );
    assert.deepEqual(aggregateMatrix(BareAggregation.Sum, []), []);
  });
});
