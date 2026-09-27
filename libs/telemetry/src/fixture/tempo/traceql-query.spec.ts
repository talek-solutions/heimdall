import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TempoSpanKind, TempoStatusCode } from '../../connectors/tempo/tempo.enums';
import type { IGeneratedSpan, IGeneratedTrace } from './trace.generator';
import { parseTraceQuery } from './traceql-query';

function span(overrides: Partial<IGeneratedSpan>): IGeneratedSpan {
  return {
    spanId: 'a'.repeat(16),
    parentSpanId: undefined,
    service: 'checkout',
    name: 'POST /api/checkout',
    kind: TempoSpanKind.Server,
    startNs: 0n,
    durationNs: 120_000_000n,
    status: TempoStatusCode.Unset,
    statusMessage: undefined,
    attributes: { 'http.response.status_code': 200 },
    events: [],
    ...overrides,
  };
}

const TRACE: IGeneratedTrace = {
  traceId: 'f'.repeat(32),
  startNs: 0n,
  isError: true,
  spans: [
    span({ durationNs: 5_010_000_000n, status: TempoStatusCode.Error, attributes: { 'http.response.status_code': 504 } }),
    span({
      spanId: 'b'.repeat(16),
      name: 'UPDATE orders',
      kind: TempoSpanKind.Client,
      durationNs: 4_700_000_000n,
      status: TempoStatusCode.Error,
      attributes: { 'db.system': 'postgresql', 'db.operation.name': 'UPDATE' },
    }),
    span({ spanId: 'c'.repeat(16), service: 'inventory', name: 'POST /reserve', durationNs: 9_000_000n }),
  ],
};

function spanNames(query: string): string[] {
  return parseTraceQuery(query).matchingSpans(TRACE).map((matched) => matched.name);
}

describe('parseTraceQuery', () => {
  it('matches everything for an empty span set', () => {
    assert.equal(parseTraceQuery('{}').matches(TRACE), true);
    assert.equal(spanNames('{}').length, 3);
  });

  it('evaluates intrinsics, the service name and span attributes on one span', () => {
    assert.deepEqual(spanNames('{ resource.service.name = "inventory" }'), ['POST /reserve']);
    assert.deepEqual(spanNames('{ .service.name != "checkout" }'), ['POST /reserve']);
    assert.deepEqual(spanNames('{ status = error && kind = client }'), ['UPDATE orders']);
    assert.deepEqual(spanNames('{ span.db.system = "postgresql" }'), ['UPDATE orders']);
    assert.deepEqual(spanNames('{ .http.response.status_code >= 500 }'), ['POST /api/checkout']);
    assert.deepEqual(spanNames('{ name =~ "UPDATE.*" }'), ['UPDATE orders']);
  });

  it('compares durations with units', () => {
    assert.deepEqual(spanNames('{ duration > 1s }'), ['POST /api/checkout', 'UPDATE orders']);
    assert.deepEqual(spanNames('{ duration < 10ms }'), ['POST /reserve']);
    assert.equal(parseTraceQuery('{ traceDuration > 5s }').matches(TRACE), true);
    assert.equal(parseTraceQuery('{ traceDuration > 6s }').matches(TRACE), false);
  });

  it('checks trace-level fields against the root', () => {
    assert.equal(parseTraceQuery('{ rootServiceName = "checkout" }').matches(TRACE), true);
    assert.equal(parseTraceQuery('{ rootName = "GET /" }').matches(TRACE), false);
  });

  it('never matches a missing attribute, even with !=', () => {
    assert.deepEqual(spanNames('{ span.cache.name != "x" }'), []);
    assert.equal(parseTraceQuery('{ span.cache.name != "x" }').matches(TRACE), false);
  });

  it('ignores condition-shaped text inside strings', () => {
    assert.deepEqual(spanNames('{ name = "status = error" }'), []);
  });
});
