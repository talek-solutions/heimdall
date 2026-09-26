import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { NO_AUTH_SOURCE, clientReturning, fakeFetch, queryOf } from '../__fixtures__/fake-fetch.fixture';
import { TelemetryHttpClient } from '../http/telemetry-http.client';
import {
  CHILD_SPAN_ID_HEX,
  ROOT_SPAN_ID_HEX,
  TEMPO_SEARCH_RESPONSE,
  TEMPO_TRACE_RESPONSE,
  TRACE_ID_HEX,
} from './__fixtures__/tempo.fixture';
import { TempoConnector } from './tempo.connector';
import { TempoSpanKind, TempoStatusCode } from './tempo.enums';

describe('TempoConnector', () => {
  describe('getTrace', () => {
    it('requests the v2 trace endpoint with an encoded ID', async () => {
      const { client, calls } = clientReturning(TEMPO_TRACE_RESPONSE);

      await new TempoConnector(client).getTrace({ traceId: '../admin' });

      assert.equal(calls[0]?.url, 'https://backend.example/api/v2/traces/..%2Fadmin');
      assert.equal(calls[0]?.headers['accept'], 'application/json');
    });

    it('maps OTLP spans, normalising IDs, enums, timestamps and attributes', async () => {
      const { client } = clientReturning(TEMPO_TRACE_RESPONSE);

      const trace = await new TempoConnector(client).getTrace({ traceId: TRACE_ID_HEX.toUpperCase() });

      assert.equal(trace?.traceId, TRACE_ID_HEX);
      assert.equal(trace?.spans.length, 2);
      assert.deepEqual(trace?.spans[0], {
        traceId: TRACE_ID_HEX,
        spanId: ROOT_SPAN_ID_HEX,
        parentSpanId: undefined,
        name: 'POST /checkout',
        kind: TempoSpanKind.Server,
        serviceName: 'checkout',
        startTimeUnixNano: '1758783600000000000',
        durationMs: 250.5,
        status: { code: TempoStatusCode.Error, message: 'upstream failed' },
        attributes: {
          'http.response.status_code': 502,
          retry: true,
          ratio: 0.5,
          tags: ['a', 'b'],
          db: { system: 'postgresql' },
        },
        resourceAttributes: { 'service.name': 'checkout', 'k8s.pod.restarts': 3 },
        events: [
          {
            name: 'exception',
            timeUnixNano: '1758783600200000000',
            attributes: { 'exception.message': 'gateway timeout' },
          },
        ],
      });

      const child = trace?.spans[1];
      assert.equal(child?.traceId, TRACE_ID_HEX);
      assert.equal(child?.spanId, CHILD_SPAN_ID_HEX);
      assert.equal(child?.parentSpanId, ROOT_SPAN_ID_HEX);
      assert.equal(child?.kind, TempoSpanKind.Client);
      assert.equal(child?.status.code, TempoStatusCode.Unset);
      assert.equal(child?.durationMs, 200);
    });

    it('accepts the v1 `batches` body', async () => {
      const { client } = clientReturning({ batches: TEMPO_TRACE_RESPONSE.trace.resourceSpans });

      const trace = await new TempoConnector(client).getTrace({ traceId: TRACE_ID_HEX });

      assert.equal(trace?.spans.length, 2);
    });

    it('returns undefined when Tempo has no such trace', async () => {
      const { fetchFn } = fakeFetch(() => new Response('trace not found', { status: 404 }));
      const client = new TelemetryHttpClient({ source: NO_AUTH_SOURCE, lookupEnv: () => undefined, fetchFn });

      assert.equal(await new TempoConnector(client).getTrace({ traceId: TRACE_ID_HEX }), undefined);
    });

    it('rejects malformed bodies with INVALID_RESPONSE', async () => {
      const bodies = [
        { trace: {} },
        { resourceSpans: [{ scopeSpans: [{ spans: [{ name: 'no ids' }] }] }] },
        { resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'ab', spanId: 'cd', startTimeUnixNano: 'soon' }] }] }] },
      ];

      for (const body of bodies) {
        const { client } = clientReturning(body);
        await assert.rejects(
          new TempoConnector(client).getTrace({ traceId: TRACE_ID_HEX }),
          (error: unknown) =>
            error instanceof TelemetryError && error.errorCode === TelemetryErrorCode.InvalidResponse,
        );
      }
    });
  });

  describe('search', () => {
    it('sends TraceQL with unix-second bounds and optional params', async () => {
      const { client, calls } = clientReturning(TEMPO_SEARCH_RESPONSE);

      await new TempoConnector(client).search({
        query: '{ resource.service.name = "checkout" && status = error }',
        start: new Date('2026-09-25T07:00:00.900Z'),
        end: new Date('2026-09-25T08:00:00.000Z'),
        limit: 20,
        spansPerSpanSet: 3,
      });

      const params = queryOf(calls[0]);
      assert.equal(new URL(calls[0]?.url ?? '').pathname, '/api/search');
      assert.equal(params.get('q'), '{ resource.service.name = "checkout" && status = error }');
      assert.equal(params.get('start'), '1790319600');
      assert.equal(params.get('end'), '1790323200');
      assert.equal(params.get('limit'), '20');
      assert.equal(params.get('spss'), '3');
    });

    it('maps trace summaries, including the legacy single spanSet', async () => {
      const { client } = clientReturning(TEMPO_SEARCH_RESPONSE);

      const result = await new TempoConnector(client).search({ query: '{}' });

      assert.deepEqual(result.traces[0], {
        traceId: '2f3e0cee77ae5dc9c17ade3689eb2e54',
        rootServiceName: 'checkout',
        rootTraceName: 'POST /checkout',
        startTimeUnixNano: '1758783600000000000',
        durationMs: 250,
        spanSets: [
          {
            matched: 4,
            spans: [
              {
                spanId: '563d623c76514f8e',
                name: undefined,
                startTimeUnixNano: '1758783600010000000',
                durationNs: '200000000',
                attributes: { status: 'error' },
              },
            ],
          },
        ],
      });
      assert.deepEqual(result.traces[1], {
        traceId: '6f1b49',
        rootServiceName: undefined,
        rootTraceName: undefined,
        startTimeUnixNano: '1758783500000000000',
        durationMs: undefined,
        spanSets: [{ matched: 0, spans: [] }],
      });
    });

    it('rejects a body without traces with INVALID_RESPONSE', async () => {
      const { client } = clientReturning({ metrics: {} });

      await assert.rejects(
        new TempoConnector(client).search({ query: '{}' }),
        (error: unknown) =>
          error instanceof TelemetryError && error.errorCode === TelemetryErrorCode.InvalidResponse,
      );
    });
  });
});
