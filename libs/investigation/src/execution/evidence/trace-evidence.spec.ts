import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TempoSpanKind,
  TempoStatusCode,
  type IRedactedSpan,
  type ITraceMatch,
  type RedactedText,
} from '@heimdall/telemetry';
import { OperationChange } from './evidence.enums';
import { compareOperations, traceView } from './trace-evidence';

function trace(
  id: string,
  rootMs: number,
  spans: ReadonlyArray<readonly [string, number, string?]>,
): ITraceMatch {
  return {
    traceId: id,
    rootServiceName: undefined,
    rootName: undefined,
    startMs: 0,
    durationMs: rootMs,
    matched: spans.length,
    spans: spans.map(([name, durationMs, errorType], index) => ({
      spanId: `${id}-${index}`,
      name: name as RedactedText,
      startMs: 0,
      durationMs,
      attributes: errorType === undefined ? {} : { 'error.type': errorType as RedactedText },
    })),
  };
}

function span(id: string, parent: string | undefined, startMs: number): IRedactedSpan {
  return {
    spanId: id,
    parentSpanId: parent,
    service: undefined,
    name: id as RedactedText,
    kind: TempoSpanKind.Internal,
    startMs,
    durationMs: 1,
    status: { code: TempoStatusCode.Unset, message: undefined },
    attributes: {},
    exceptions: [],
  };
}

describe('compareOperations (log-and-trace-evidence.md, Traces)', () => {
  it('calls an operation slower by p50 or by its share of the trace, new when the baseline lacks it, and failing by error traces', () => {
    const operations = compareOperations({
      window: [
        trace('w1', 1_000, [
          ['UPDATE orders', 900],
          ['POST /charges', 40],
          ['cache.get', 2],
        ]),
        trace('w2', 1_000, [
          ['UPDATE orders', 800],
          ['POST /charges', 42],
        ]),
      ],
      baseline: [
        trace('b1', 200, [
          ['UPDATE orders', 30],
          ['POST /charges', 40],
        ]),
        trace('b2', 200, [
          ['UPDATE orders', 32],
          ['POST /charges', 41],
        ]),
      ],
      windowErrors: [trace('e1', 5_000, [['UPDATE orders', 4_900, 'PoolTimeoutError']])],
      baselineErrors: [],
    });
    const byName = new Map(operations.map((operation) => [operation.name, operation]));

    assert.deepEqual(byName.get('UPDATE orders')?.changes, [
      OperationChange.Slower,
      OperationChange.Errors,
    ]);
    assert.deepEqual(byName.get('UPDATE orders')?.errorTypes, ['PoolTimeoutError']);
    assert.deepEqual(byName.get('cache.get')?.changes, [OperationChange.New]);
    assert.deepEqual(
      byName.get('POST /charges')?.changes,
      [],
      'same time, a smaller share: not slower',
    );
    assert.equal(operations[0]?.name, 'UPDATE orders', 'the most changed first');
  });

  it('needs a 5 ms difference as well as the ratio before calling an operation slower', () => {
    const [operation] = compareOperations({
      // Its share of the trace is unchanged, so only the p50 rule could fire.
      window: [trace('w', 300, [['cache.get', 3]])],
      baseline: [trace('b', 100, [['cache.get', 1]])],
      windowErrors: [],
      baselineErrors: [],
    });

    assert.deepEqual(operation?.changes, []);
  });
});

describe('traceView', () => {
  it('lists spans depth first from the root, children by start time', () => {
    const view = traceView({
      traceId: 't',
      spans: [
        span('db', 'root', 20),
        span('root', undefined, 0),
        span('auth', 'root', 5),
        span('row', 'db', 21),
      ],
    });

    assert.deepEqual(
      view.spans.map(({ name, depth }) => `${depth}:${name}`),
      ['0:root', '1:auth', '1:db', '2:row'],
    );
    assert.equal(view.omittedSpans, 0);
  });
});
