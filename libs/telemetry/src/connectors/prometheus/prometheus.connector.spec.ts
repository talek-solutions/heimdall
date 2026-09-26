import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { clientReturning } from '../__fixtures__/fake-fetch.fixture';
import {
  PROMETHEUS_ERROR_RESPONSE,
  PROMETHEUS_MATRIX_RESPONSE,
  PROMETHEUS_SCALAR_RESPONSE,
  PROMETHEUS_STRING_RESPONSE,
  PROMETHEUS_VECTOR_RESPONSE,
} from './__fixtures__/prometheus.fixture';
import { PrometheusConnector } from './prometheus.connector';
import { PrometheusResultType } from './prometheus.enums';

const START = new Date('2026-09-25T07:00:00.000Z');
const END = new Date('2026-09-25T08:00:00.000Z');

describe('PrometheusConnector', () => {
  it('queryRange form-POSTs PromQL with RFC 3339 bounds and a step', async () => {
    const { client, calls } = clientReturning(PROMETHEUS_MATRIX_RESPONSE);

    await new PrometheusConnector(client).queryRange({
      query: 'rate(http_requests_total{job="checkout"}[5m])',
      start: START,
      end: END,
      stepSeconds: 60,
    });

    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.url, 'https://backend.example/api/v1/query_range');
    const form = new URLSearchParams(calls[0]?.body);
    assert.equal(form.get('query'), 'rate(http_requests_total{job="checkout"}[5m])');
    assert.equal(form.get('start'), '2026-09-25T07:00:00.000Z');
    assert.equal(form.get('end'), '2026-09-25T08:00:00.000Z');
    assert.equal(form.get('step'), '60');
  });

  it('query posts to the instant endpoint and omits an unset time', async () => {
    const { client, calls } = clientReturning(PROMETHEUS_VECTOR_RESPONSE);

    await new PrometheusConnector(client).query({ query: 'up == 0' });

    assert.equal(calls[0]?.url, 'https://backend.example/api/v1/query');
    assert.equal(new URLSearchParams(calls[0]?.body).has('time'), false);
  });

  it('maps a vector', async () => {
    const { client } = clientReturning(PROMETHEUS_VECTOR_RESPONSE);

    const result = await new PrometheusConnector(client).query({ query: 'up' });

    assert.deepEqual(result, {
      data: {
        resultType: PrometheusResultType.Vector,
        samples: [
          { labels: { __name__: 'up', job: 'checkout' }, sample: { timestampMs: 1758783600123, value: 0 } },
        ],
      },
      warnings: [],
    });
  });

  it('maps a matrix and passes warnings through', async () => {
    const { client } = clientReturning(PROMETHEUS_MATRIX_RESPONSE);

    const result = await new PrometheusConnector(client).queryRange({ query: 'x', start: START, end: END, stepSeconds: 60 });

    assert.ok(result.data.resultType === PrometheusResultType.Matrix);
    assert.deepEqual(result.data.series[0]?.samples, [
      { timestampMs: 1758783600000, value: 0.25 },
      { timestampMs: 1758783660000, value: Infinity },
    ]);
    assert.deepEqual(result.warnings, ['PromQL info: metric might not be a counter']);
  });

  it('maps scalar and string results', async () => {
    const scalar = await new PrometheusConnector(clientReturning(PROMETHEUS_SCALAR_RESPONSE).client).query({ query: '42' });
    const text = await new PrometheusConnector(clientReturning(PROMETHEUS_STRING_RESPONSE).client).query({ query: '"hello"' });

    assert.deepEqual(scalar.data, {
      resultType: PrometheusResultType.Scalar,
      sample: { timestampMs: 1758783600000, value: 42 },
    });
    assert.deepEqual(text.data, {
      resultType: PrometheusResultType.String,
      timestampMs: 1758783600000,
      value: 'hello',
    });
  });

  it('turns a status:error body into QUERY_REJECTED with the backend reason', async () => {
    const { client } = clientReturning(PROMETHEUS_ERROR_RESPONSE);

    await assert.rejects(
      new PrometheusConnector(client).query({ query: 'x' }),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.QueryRejected &&
        error.message.includes('execution') &&
        error.message.includes('too many samples'),
    );
  });

  it('rejects malformed bodies with INVALID_RESPONSE', async () => {
    const bodies = [
      [],
      { status: 'success' },
      { status: 'success', data: { resultType: 'streams', result: [] } },
      { status: 'success', data: { resultType: 'vector', result: [{ metric: {}, value: ['1', '2'] }] } },
    ];

    for (const body of bodies) {
      const { client } = clientReturning(body);
      await assert.rejects(
        new PrometheusConnector(client).query({ query: 'x' }),
        (error: unknown) =>
          error instanceof TelemetryError && error.errorCode === TelemetryErrorCode.InvalidResponse,
      );
    }
  });
});
