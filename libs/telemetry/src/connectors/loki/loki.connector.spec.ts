import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { clientReturning, queryOf } from '../__fixtures__/fake-fetch.fixture';
import { LOKI_MATRIX_RESPONSE, LOKI_STREAMS_RESPONSE, LOKI_VECTOR_RESPONSE } from './__fixtures__/loki.fixture';
import { LokiConnector } from './loki.connector';
import { LokiDirection, LokiResultType } from './loki.enums';

const START = new Date('2026-09-25T07:00:00.000Z');
const END = new Date('2026-09-25T08:00:00.000Z');

describe('LokiConnector', () => {
  it('queryRange sends LogQL with nanosecond bounds and optional params', async () => {
    const { client, calls } = clientReturning(LOKI_STREAMS_RESPONSE);

    await new LokiConnector(client).queryRange({
      query: '{service_name="checkout"} |= "timeout"',
      start: START,
      end: END,
      limit: 100,
      direction: LokiDirection.Backward,
    });

    const params = queryOf(calls[0]);
    assert.equal(new URL(calls[0]?.url ?? '').pathname, '/loki/api/v1/query_range');
    assert.equal(params.get('query'), '{service_name="checkout"} |= "timeout"');
    assert.equal(params.get('start'), '1790319600000000000');
    assert.equal(params.get('end'), '1790323200000000000');
    assert.equal(params.get('limit'), '100');
    assert.equal(params.get('direction'), 'backward');
    assert.equal(params.has('step'), false);
  });

  it('query hits the instant endpoint and omits an unset time', async () => {
    const { client, calls } = clientReturning(LOKI_VECTOR_RESPONSE);

    await new LokiConnector(client).query({ query: 'sum(count_over_time({level="error"}[5m]))' });

    assert.equal(new URL(calls[0]?.url ?? '').pathname, '/loki/api/v1/query');
    assert.equal(queryOf(calls[0]).has('time'), false);
  });

  it('maps streams to labelled entries with lossless timestamps', async () => {
    const { client } = clientReturning(LOKI_STREAMS_RESPONSE);

    const result = await new LokiConnector(client).queryRange({ query: '{}', start: START, end: END });

    assert.deepEqual(result, {
      resultType: LokiResultType.Streams,
      streams: [
        {
          labels: { service_name: 'checkout', level: 'error' },
          entries: [
            { timestampNs: '1758783600000000001', line: 'payment gateway timeout after 30000ms' },
            { timestampNs: '1758783599000000000', line: 'retrying charge' },
          ],
        },
      ],
    });
  });

  it('maps a metric matrix to millisecond samples, preserving NaN', async () => {
    const { client } = clientReturning(LOKI_MATRIX_RESPONSE);

    const result = await new LokiConnector(client).queryRange({ query: 'rate({}[1m])', start: START, end: END, stepSeconds: 60 });

    assert.equal(result.resultType, LokiResultType.Matrix);
    assert.ok(result.resultType === LokiResultType.Matrix);
    assert.deepEqual(result.series[0]?.labels, { service_name: 'checkout' });
    assert.deepEqual(result.series[0]?.samples[0], { timestampMs: 1758783600000, value: 12 });
    assert.equal(result.series[0]?.samples[1]?.timestampMs, 1758783660500);
    assert.ok(Number.isNaN(result.series[0]?.samples[1]?.value));
  });

  it('maps a metric vector', async () => {
    const { client } = clientReturning(LOKI_VECTOR_RESPONSE);

    const result = await new LokiConnector(client).query({ query: 'x' });

    assert.deepEqual(result, {
      resultType: LokiResultType.Vector,
      samples: [{ labels: { level: 'error' }, sample: { timestampMs: 1758783600000, value: 3 } }],
    });
  });

  it('rejects malformed bodies with INVALID_RESPONSE', async () => {
    const bodies = [
      {},
      { data: { resultType: 'streams' } },
      { data: { resultType: 'scalar', result: [] } },
      { data: { resultType: 'streams', result: [{ stream: {}, values: [[1, 'not-a-string-ts']] }] } },
      { data: { resultType: 'streams', result: [{ stream: { level: 3 }, values: [] }] } },
    ];

    for (const body of bodies) {
      const { client } = clientReturning(body);
      await assert.rejects(
        new LokiConnector(client).query({ query: 'x' }),
        (error: unknown) =>
          error instanceof TelemetryError && error.errorCode === TelemetryErrorCode.InvalidResponse,
      );
    }
  });
});
