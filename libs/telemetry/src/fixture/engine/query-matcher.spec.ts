import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractLabelMatchers,
  LabelMatchOperator,
  labelsSatisfy,
  selectAllMatching,
  selectMatching,
} from './query-matcher';

const LATENCY = /histogram_quantile/;
const RATE = /http_requests_total/;

const candidates = [
  { id: 'checkout_p99', match: LATENCY, labels: { service: 'checkout' } },
  { id: 'payments_p99', match: LATENCY, labels: { service: 'payments' } },
  { id: 'checkout_200', match: RATE, labels: { service: 'checkout', code: '200' } },
  { id: 'checkout_504', match: RATE, labels: { service: 'checkout', code: '504' } },
];

function ids(query: string): string[] {
  return selectMatching(query, candidates).map((candidate) => candidate.id);
}

describe('selectMatching', () => {
  it('returns the whole family of the first matching pattern', () => {
    assert.deepEqual(ids('histogram_quantile(0.99, sum by (le, service) (rate(x_bucket[5m])))'), [
      'checkout_p99',
      'payments_p99',
    ]);
  });

  it('narrows by label matchers written in the query', () => {
    assert.deepEqual(ids('histogram_quantile(0.99, rate(x_bucket{service="payments"}[5m]))'), [
      'payments_p99',
    ]);
    assert.deepEqual(ids('sum(rate(http_requests_total{service="checkout",code=~"5.."}[5m]))'), [
      'checkout_504',
    ]);
    assert.deepEqual(ids('rate(http_requests_total{code!="200"}[5m])'), ['checkout_504']);
    assert.deepEqual(ids('rate(http_requests_total{code!~"2.."}[5m])'), ['checkout_504']);
  });

  it('ignores matchers on labels a candidate does not carry', () => {
    assert.deepEqual(ids('histogram_quantile(0.99, rate(x_bucket{route="/pay",service="checkout"}[5m]))'), [
      'checkout_p99',
    ]);
  });

  it('returns nothing when no pattern matches', () => {
    assert.deepEqual(ids('up'), []);
  });

  it('never lets one family answer for another', () => {
    assert.deepEqual(ids('rate(http_requests_total[5m])'), ['checkout_200', 'checkout_504']);
  });
});

describe('extractLabelMatchers', () => {
  it('reads every operator and unescapes values', () => {
    assert.deepEqual(extractLabelMatchers('x{a="1", b!="2", c=~"5\\\\..", d!~`raw\\d`}'), [
      { name: 'a', operator: LabelMatchOperator.Equal, value: '1' },
      { name: 'b', operator: LabelMatchOperator.NotEqual, value: '2' },
      { name: 'c', operator: LabelMatchOperator.RegexMatch, value: '5\\..' },
      { name: 'd', operator: LabelMatchOperator.RegexNoMatch, value: 'raw\\d' },
    ]);
  });

  it('skips string literals, even ones that look like matchers', () => {
    assert.deepEqual(extractLabelMatchers('{app="x"} |= "user=\\"bob\\"" |= "a=" level="error"'), [
      { name: 'app', operator: LabelMatchOperator.Equal, value: 'x' },
      { name: 'level', operator: LabelMatchOperator.Equal, value: 'error' },
    ]);
  });

  it('ignores dotted attributes and numeric comparisons', () => {
    assert.deepEqual(extractLabelMatchers('{ resource.service.name = "checkout" } x != 0'), []);
  });
});

describe('labelsSatisfy', () => {
  it('anchors regex matchers and tolerates an invalid pattern', () => {
    const labels = { code: '504' };

    assert.equal(labelsSatisfy(labels, [{ name: 'code', operator: LabelMatchOperator.RegexMatch, value: '50' }]), false);
    assert.equal(labelsSatisfy(labels, [{ name: 'code', operator: LabelMatchOperator.RegexMatch, value: '(' }]), true);
    assert.equal(labelsSatisfy(labels, [{ name: 'code', operator: LabelMatchOperator.RegexNoMatch, value: '(' }]), true);
  });
});

describe('selectAllMatching', () => {
  it('returns every candidate whose pattern matches, not just the first family', () => {
    const streams = [
      { id: 'any_checkout', match: /(?:)/, labels: { service_name: 'checkout' } },
      { id: 'any_payments', match: /(?:)/, labels: { service_name: 'payments' } },
      { id: 'audit_only', match: /audit/, labels: { service_name: 'checkout' } },
    ];
    const ids = (query: string): string[] =>
      selectAllMatching(query, streams).map((stream) => stream.id);

    assert.deepEqual(ids('{service_name="checkout"}'), ['any_checkout']);
    assert.deepEqual(ids('{service_name="checkout"} |= "audit"'), ['any_checkout', 'audit_only']);
  });
});
