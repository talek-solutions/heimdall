import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { TelemetryHttpClient } from '../../connectors/http/telemetry-http.client';
import type { LokiQueryResult, LokiStream } from '../../connectors/loki/api/loki.response';
import { LokiConnector } from '../../connectors/loki/loki.connector';
import { LokiDirection, LokiResultType } from '../../connectors/loki/loki.enums';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { loadScenario, removeScenarioRoots } from '../__fixtures__/scenario-files.fixture';
import { Timeline } from '../engine/timeline';
import { createFixtureFetch } from '../fixture-fetch';
import { ScenarioFile } from '../scenario/scenario.enums';
import { LokiFixtureBackend } from './loki-fixture.backend';

// Timeline 06:00 → 08:00; latency ramps and error lines appear from 07:30.
const ANCHOR = new Date('2026-09-25T08:00:00.000Z');
const NANOS_PER_MILLI = 1_000_000n;

const METRICS = `
series:
  - id: checkout_p99
    match: 'histogram_quantile'
    curve:
      baseline: 0.2
      phases:
        - { shape: ramp, at: 90m, to: 2.2, over: 0s }
`;

const LOGS = `
streams:
  - id: checkout_info
    labels: { service_name: checkout, level: info }
    rate: { baseline: 5 }
    templates:
      - line: 'level=info msg="request completed" duration_ms={ref:checkout_p99*1000}'
  - id: checkout_error
    labels: { service_name: checkout, level: error }
    rate: { baseline: 2 }
    templates:
      - line: 'level=error msg="payment declined"'
        weight: { baseline: 1 }
      - line: 'level=error msg="acquire connection timeout"'
        weight:
          baseline: 0
          phases:
            - { shape: ramp, at: 90m, to: 100, over: 0s }
  - id: payments
    labels: { service_name: payments }
    rate: { baseline: 3 }
    templates:
      - line: 'level=info msg="charge authorized"'
series:
  - id: errors_per_second
    match: 'count_over_time'
    labels: { service_name: checkout, level: error }
    scaleByRange: true
    curve: { baseline: 2 }
`;

function streams(result: LokiQueryResult): readonly LokiStream[] {
  assert.equal(result.resultType, LokiResultType.Streams);
  return result.resultType === LokiResultType.Streams ? result.streams : [];
}

function entries(result: LokiQueryResult): { labels: Readonly<Record<string, string>>; timestampNs: bigint; line: string }[] {
  return streams(result).flatMap((stream) =>
    stream.entries.map((entry) => ({ labels: stream.labels, timestampNs: BigInt(entry.timestampNs), line: entry.line })),
  );
}

function rejectedWith(fragment: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof TelemetryError &&
    error.errorCode === TelemetryErrorCode.QueryRejected &&
    error.message.includes(fragment);
}

describe('LokiFixtureBackend through LokiConnector', () => {
  let loki: LokiConnector;

  before(async () => {
    const scenario = await loadScenario({ [ScenarioFile.Metrics]: METRICS, [ScenarioFile.Logs]: LOGS });
    const backend = new LokiFixtureBackend(
      scenario.logs,
      new Timeline(ANCHOR, scenario.durationMs),
      scenario.seed,
      undefined,
    );
    loki = new LokiConnector(
      new TelemetryHttpClient({
        source: { url: 'http://loki.fixture.invalid', timeoutMs: 1_000, auth: { scheme: AuthScheme.None } },
        lookupEnv: () => undefined,
        fetchFn: createFixtureFetch(backend),
      }),
    );
  });

  after(removeScenarioRoots);

  it('returns the newest 100 lines of the streams the selector matches, by default', async () => {
    const result = await loki.queryRange({ query: '{service_name="checkout"}', start: new Date(0), end: ANCHOR });
    const found = entries(result);

    assert.equal(found.length, 100);
    assert.ok(found.every((entry) => entry.labels['service_name'] === 'checkout'));
    assert.ok(found.every((entry) => entry.timestampNs <= BigInt(ANCHOR.getTime()) * NANOS_PER_MILLI));
    // Loki groups entries by stream; within a stream, backward means newest first.
    for (const stream of streams(result)) {
      const timestamps = stream.entries.map((entry) => BigInt(entry.timestampNs));
      assert.ok(timestamps.every((timestamp, index) => index === 0 || timestamp <= (timestamps[index - 1] ?? 0n)));
    }
  });

  it('walks forward from the start when asked, honouring the limit', async () => {
    const start = new Date('2026-09-25T06:30:00Z');
    const found = entries(
      await loki.queryRange({
        query: '{service_name="payments"}',
        start,
        end: ANCHOR,
        limit: 7,
        direction: LokiDirection.Forward,
      }),
    );

    assert.equal(found.length, 7);
    assert.ok((found[0]?.timestampNs ?? 0n) >= BigInt(start.getTime()) * NANOS_PER_MILLI);
    assert.ok((found[0]?.timestampNs ?? 0n) < (found[6]?.timestampNs ?? 0n));
  });

  it('narrows by every stream label in the selector', async () => {
    const found = entries(
      await loki.queryRange({ query: '{service_name="checkout", level="error"}', start: new Date(0), end: ANCHOR }),
    );

    assert.ok(found.length > 0);
    assert.ok(found.every((entry) => entry.labels['level'] === 'error'));
  });

  it('applies line filters to the generated lines', async () => {
    const found = entries(
      await loki.queryRange({
        query: '{service_name="checkout"} |= "timeout"',
        start: new Date('2026-09-25T07:00:00Z'),
        end: ANCHOR,
        limit: 5_000,
      }),
    );

    assert.ok(found.length > 1_000, `found ${found.length}`);
    assert.ok(found.every((entry) => entry.line.includes('timeout')));
    // The timeout template only exists from 07:30.
    assert.ok(found.every((entry) => entry.timestampNs >= BigInt(Date.parse('2026-09-25T07:30:00Z')) * NANOS_PER_MILLI));
  });

  it('generates lines at the stream rate', async () => {
    const found = entries(
      await loki.queryRange({
        query: '{service_name="payments"}',
        start: new Date('2026-09-25T07:00:00Z'),
        end: new Date('2026-09-25T07:10:00Z'),
        limit: 5_000,
      }),
    );

    // 3 lines/s for 600s: 1800 expected, Poisson spread ~42.
    assert.ok(Math.abs(found.length - 1_800) < 200, `found ${found.length}`);
  });

  it('fills {ref:} placeholders from the metric curve at the line time', async () => {
    const query = '{service_name="checkout", level="info"}';
    const before = entries(await loki.queryRange({ query, start: new Date('2026-09-25T07:00:00Z'), end: new Date('2026-09-25T07:01:00Z'), limit: 5 }));
    const during = entries(await loki.queryRange({ query, start: new Date('2026-09-25T07:40:00Z'), end: new Date('2026-09-25T07:41:00Z'), limit: 5 }));

    assert.ok(before.every((entry) => entry.line.endsWith('duration_ms=200')));
    assert.ok(during.every((entry) => entry.line.endsWith('duration_ms=2200')));
  });

  it('answers identical and overlapping windows with the same lines', async () => {
    const query = '{service_name="payments"}';
    const window = { start: new Date('2026-09-25T07:00:00Z'), end: new Date('2026-09-25T07:02:00Z'), limit: 5_000 };
    const first = entries(await loki.queryRange({ query, ...window }));
    const again = entries(await loki.queryRange({ query, ...window }));
    const wider = entries(
      await loki.queryRange({ query, ...window, start: new Date('2026-09-25T06:59:30.500Z') }),
    );

    assert.deepEqual(first, again);
    assert.deepEqual(wider.slice(0, first.length), first);
  });

  it('answers metric LogQL from series, scaled by the range selector', async () => {
    const perMinute = await loki.query({ query: 'sum(count_over_time({service_name="checkout", level="error"}[1m]))' });
    const perFiveMinutes = await loki.query({ query: 'sum(count_over_time({level="error"}[5m]))' });

    assert.equal(perMinute.resultType, LokiResultType.Vector);
    if (perMinute.resultType === LokiResultType.Vector && perFiveMinutes.resultType === LokiResultType.Vector) {
      assert.equal(perMinute.samples[0]?.sample.value, 120);
      assert.equal(perFiveMinutes.samples[0]?.sample.value, 600);
    }
  });

  it('answers a metric range query with Loki’s default step', async () => {
    const result = await loki.queryRange({
      query: 'count_over_time({service_name="checkout", level="error"}[1m])',
      start: new Date('2026-09-25T06:00:00Z'),
      end: ANCHOR,
    });

    assert.equal(result.resultType, LokiResultType.Matrix);
    if (result.resultType === LokiResultType.Matrix) {
      // 7200s / 250 → a 28s step.
      const samples = result.series[0]?.samples ?? [];
      assert.equal((samples[1]?.timestampMs ?? 0) - (samples[0]?.timestampMs ?? 0), 28_000);
    }
  });

  it('rejects what Loki rejects', async () => {
    await assert.rejects(loki.query({ query: '{service_name="checkout"}' }), rejectedWith('instant query type'));
    await assert.rejects(
      loki.queryRange({ query: '{service_name="checkout"}', start: new Date(0), end: ANCHOR, limit: 5_001 }),
      rejectedWith('max entries limit'),
    );
    await assert.rejects(
      loki.queryRange({ query: '{service_name="checkout"}', start: ANCHOR, end: new Date(0) }),
      rejectedWith('end timestamp must not be before'),
    );
    await assert.rejects(
      loki.queryRange({ query: '{service_name="checkout"} |~ "("', start: new Date(0), end: ANCHOR }),
      rejectedWith('invalid regular expression'),
    );
  });
});
