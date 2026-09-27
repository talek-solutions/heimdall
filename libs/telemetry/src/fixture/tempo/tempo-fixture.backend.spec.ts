import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { TelemetryHttpClient } from '../../connectors/http/telemetry-http.client';
import { TempoConnector } from '../../connectors/tempo/tempo.connector';
import { TempoSpanKind, TempoStatusCode } from '../../connectors/tempo/tempo.enums';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { loadScenario, removeScenarioRoots } from '../__fixtures__/scenario-files.fixture';
import { Timeline } from '../engine/timeline';
import { createFixtureFetch } from '../fixture-fetch';
import { ScenarioFile } from '../scenario/scenario.enums';
import { TempoFixtureBackend } from './tempo-fixture.backend';
import { TraceGenerator } from './trace.generator';
import { TraceIdCodec } from './trace-id.codec';

// Timeline 06:00 → 08:00. From 07:30 every trace is an error and the DB span takes 90%.
const ANCHOR = new Date('2026-09-25T08:00:00.000Z');
const BEFORE = { start: new Date('2026-09-25T07:00:00Z'), end: new Date('2026-09-25T07:10:00Z') };
const DURING = { start: new Date('2026-09-25T07:40:00Z'), end: new Date('2026-09-25T07:50:00Z') };

const METRICS = `
series:
  - id: latency_ms
    match: 'x'
    curve:
      baseline: 100
      phases:
        - { shape: ramp, at: 90m, to: 5000, over: 0s }
`;

const TRACES = `
traces:
  - id: checkout_post
    rate: { baseline: 2 }
    duration: { ref: latency_ms }
    jitter: 0.1
    error:
      baseline: 0
      phases:
        - { shape: ramp, at: 90m, to: 1, over: 0s }
    root:
      service: checkout
      name: POST /api/checkout
      kind: server
      attributes: { http.response.status_code: 200 }
      errorAttributes: { http.response.status_code: 504 }
      children:
        - service: checkout
          name: UPDATE orders
          kind: client
          attributes: { db.system: postgresql }
          errorSource: true
          errorMessage: pool exhausted
          share:
            baseline: 0.2
            phases:
              - { shape: ramp, at: 90m, to: 0.9, over: 0s }
        - service: checkout
          name: POST /reserve
          kind: client
          share:
            baseline: 0.3
            phases:
              - { shape: ramp, at: 90m, to: 0.03, over: 0s }
          children:
            - service: inventory
              name: POST /reserve
              kind: server
              share: { baseline: 0.9 }
  - id: inventory_lookup
    match: 'inventory'
    rate: { baseline: 1 }
    duration: { baseline: 20 }
    root:
      service: inventory
      name: GET /api/stock
      kind: server
`;

function rejectedWith(fragment: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof TelemetryError &&
    error.errorCode === TelemetryErrorCode.QueryRejected &&
    error.message.includes(fragment);
}

describe('TempoFixtureBackend through TempoConnector', () => {
  let tempo: TempoConnector;
  let generator: TraceGenerator;

  before(async () => {
    const scenario = await loadScenario({ [ScenarioFile.Metrics]: METRICS, [ScenarioFile.Traces]: TRACES });
    const timeline = new Timeline(ANCHOR, scenario.durationMs);
    generator = new TraceGenerator(
      scenario.traces,
      scenario.seed,
      timeline,
      new TraceIdCodec(scenario.seed, scenario.contentHash),
    );
    tempo = new TempoConnector(
      new TelemetryHttpClient({
        source: { url: 'http://tempo.fixture.invalid', timeoutMs: 1_000, auth: { scheme: AuthScheme.None } },
        lookupEnv: () => undefined,
        fetchFn: createFixtureFetch(new TempoFixtureBackend(scenario.traces, generator, timeline)),
      }),
    );
  });

  after(removeScenarioRoots);

  it('searches newest first, 20 traces by default, within the window', async () => {
    const { traces } = await tempo.search({ query: '{}', ...BEFORE });
    const starts = traces.map((trace) => BigInt(trace.startTimeUnixNano));

    assert.equal(traces.length, 20);
    assert.ok(starts.every((start, index) => index === 0 || start <= (starts[index - 1] ?? 0n)));
    assert.ok(starts.every((start) => start <= BigInt(BEFORE.end.getTime() + 1_000) * 1_000_000n));
  });

  it('routes by template match and narrows by TraceQL conditions', async () => {
    const inventory = await tempo.search({ query: '{ resource.service.name = "inventory" }', ...BEFORE, limit: 50 });
    const rootNames = new Set(inventory.traces.map((trace) => trace.rootTraceName));

    assert.deepEqual([...rootNames].sort(), ['GET /api/stock', 'POST /api/checkout']);
    for (const trace of inventory.traces) {
      assert.ok(trace.spanSets[0]?.spans.every((span) => span.attributes['service.name'] === 'inventory'));
    }

    const checkoutOnly = await tempo.search({ query: '{ rootServiceName = "checkout" }', ...BEFORE, limit: 50 });
    assert.ok(checkoutOnly.traces.every((trace) => trace.rootServiceName === 'checkout'));
  });

  it('finds error traces only once the error curve rises', async () => {
    const before = await tempo.search({ query: '{ status = error }', ...BEFORE });
    const during = await tempo.search({ query: '{ status = error }', ...DURING, spansPerSpanSet: 5 });

    assert.equal(before.traces.length, 0);
    assert.equal(during.traces.length, 20);
    assert.deepEqual(
      during.traces[0]?.spanSets[0]?.spans.map((span) => span.name).sort(),
      ['POST /api/checkout', 'UPDATE orders'],
    );
  });

  it('serves a searched trace by ID with its whole span tree', async () => {
    const [summary] = (await tempo.search({ query: '{}', ...DURING, limit: 1 })).traces;
    const trace = await tempo.getTrace({ traceId: summary?.traceId ?? '' });
    const byName = new Map(trace?.spans.map((span) => [span.name, span]));
    const root = trace?.spans.find((span) => span.parentSpanId === undefined);
    const update = byName.get('UPDATE orders');

    assert.equal(trace?.spans.length, 4);
    assert.equal(root?.name, 'POST /api/checkout');
    assert.equal(root?.kind, TempoSpanKind.Server);
    assert.equal(root?.status.code, TempoStatusCode.Error);
    assert.equal(root?.attributes['http.response.status_code'], 504);
    assert.ok((root?.durationMs ?? 0) > 3_000);
    assert.equal(update?.parentSpanId, root?.spanId);
    assert.equal(update?.status.message, 'pool exhausted');
    assert.equal(update?.events[0]?.name, 'exception');
    assert.ok((update?.durationMs ?? 0) / (root?.durationMs ?? 1) > 0.8);
    assert.equal(byName.get('POST /reserve')?.status.code, TempoStatusCode.Unset);
    assert.deepEqual(
      trace?.spans.filter((span) => span.serviceName === 'inventory').map((span) => span.kind),
      [TempoSpanKind.Server],
    );
  });

  it('returns identical results for identical searches', async () => {
    const request = { query: '{ duration > 50ms }', ...BEFORE, limit: 5 };

    assert.deepEqual(await tempo.search(request), await tempo.search(request));
  });

  it('answers undefined for IDs it never issued, and for traces after the anchor', async () => {
    assert.equal(await tempo.getTrace({ traceId: '0af7651916cd43dd8448eb211c80319c' }), undefined);
    const future = generator.traceIdNear('checkout_post', 2 * 3_600_000 + 60_000, false);
    assert.ok(future !== undefined);
    assert.equal(await tempo.getTrace({ traceId: future }), undefined);
  });

  it('references existing traces from any instant, error traces when asked', async () => {
    const any = generator.traceIdNear('checkout_post', 30 * 60_000, false);
    const error = generator.traceIdNear('checkout_post', 100 * 60_000, true);
    const none = generator.traceIdNear('checkout_post', 30 * 60_000, true);

    assert.ok((await tempo.getTrace({ traceId: any ?? '' })) !== undefined);
    const errorTrace = await tempo.getTrace({ traceId: error ?? '' });
    assert.ok(errorTrace?.spans.some((span) => span.status.code === TempoStatusCode.Error));
    assert.equal(none, undefined);
  });

  it('rejects what Tempo rejects', async () => {
    await assert.rejects(
      tempo.search({ query: '{}', start: ANCHOR, end: new Date('2026-09-25T07:00:00Z') }),
      rejectedWith('start must be before end'),
    );
    await assert.rejects(
      tempo.search({ query: '{}', start: new Date('2026-09-01T00:00:00Z'), end: ANCHOR }),
      rejectedWith('exceeds 168h'),
    );
    await assert.rejects(tempo.getTrace({ traceId: 'not-a-trace-id' }), rejectedWith('invalid trace id'));
  });
});
