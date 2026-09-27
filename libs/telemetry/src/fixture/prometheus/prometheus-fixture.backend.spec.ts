import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { TelemetryHttpClient } from '../../connectors/http/telemetry-http.client';
import type { PrometheusQueryResult } from '../../connectors/prometheus/api/prometheus.response';
import { PrometheusConnector } from '../../connectors/prometheus/prometheus.connector';
import { PrometheusResultType } from '../../connectors/prometheus/prometheus.enums';
import type { MetricSeries } from '../../connectors/shared/metrics.response';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { loadScenario, removeScenarioRoots } from '../__fixtures__/scenario-files.fixture';
import { Timeline } from '../engine/timeline';
import { createFixtureFetch } from '../fixture-fetch';
import { ScenarioFile } from '../scenario/scenario.enums';
import type { IScenario } from '../scenario/scenario.model';
import { PrometheusFixtureBackend } from './prometheus-fixture.backend';

// Timeline: 06:00 → 08:00. The ramp runs 07:30 → 07:40 (T−30m → T−20m).
const ANCHOR = new Date('2026-09-25T08:00:00.000Z');
const P99_QUERY =
  'histogram_quantile(0.99, sum by (le, service) (rate(http_server_request_duration_seconds_bucket[5m])))';

const METRICS = `
series:
  - id: checkout_p99
    match: 'histogram_quantile\\(\\s*0?\\.99[\\s\\S]*http_server_request_duration_seconds'
    labels: { service: checkout }
    curve:
      baseline: 0.2
      phases:
        - { shape: ramp, at: 90m, to: 2.2, over: 10m }
  - id: payments_p99
    match: 'histogram_quantile\\(\\s*0?\\.99[\\s\\S]*http_server_request_duration_seconds'
    labels: { service: payments }
    curve: { baseline: 0.3 }
  - id: noisy
    match: 'noisy_metric'
    curve: { baseline: 100, noise: { stddev: 7 } }
`;

function rejectedWith(fragment: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof TelemetryError &&
    error.errorCode === TelemetryErrorCode.QueryRejected &&
    error.message.includes(fragment);
}

function matrix(result: PrometheusQueryResult): readonly MetricSeries[] {
  assert.equal(result.data.resultType, PrometheusResultType.Matrix);
  return result.data.resultType === PrometheusResultType.Matrix ? result.data.series : [];
}

function at(series: MetricSeries | undefined, iso: string): number | undefined {
  return series?.samples.find((sample) => sample.timestampMs === Date.parse(iso))?.value;
}

describe('PrometheusFixtureBackend through PrometheusConnector', () => {
  let scenario: IScenario;
  let backend: PrometheusFixtureBackend;
  let prometheus: PrometheusConnector;

  before(async () => {
    scenario = await loadScenario({ [ScenarioFile.Metrics]: METRICS });
    backend = new PrometheusFixtureBackend(scenario.metrics, new Timeline(ANCHOR, scenario.durationMs));
    prometheus = new PrometheusConnector(
      new TelemetryHttpClient({
        source: { url: 'http://prometheus.fixture.invalid', timeoutMs: 1_000, auth: { scheme: AuthScheme.None } },
        lookupEnv: () => undefined,
        fetchFn: createFixtureFetch(backend),
      }),
    );
  });

  after(removeScenarioRoots);

  it('answers a range query with the scenario curve at the requested step', async () => {
    const series = matrix(
      await prometheus.queryRange({
        query: `${P99_QUERY.replace('[5m]', '{service="checkout"}[5m]')}`,
        start: new Date('2026-09-25T06:00:00Z'),
        end: ANCHOR,
        stepSeconds: 60,
      }),
    );

    assert.equal(series.length, 1);
    assert.deepEqual(series[0]?.labels, { service: 'checkout' });
    assert.equal(series[0]?.samples.length, 121);
    assert.equal(at(series[0], '2026-09-25T07:00:00Z'), 0.2);
    assert.equal(at(series[0], '2026-09-25T07:35:00Z'), 1.2);
    assert.equal(at(series[0], '2026-09-25T07:50:00Z'), 2.2);
  });

  it('returns every series of the matching family when the query does not narrow', async () => {
    const series = matrix(
      await prometheus.queryRange({
        query: P99_QUERY,
        start: new Date('2026-09-25T07:00:00Z'),
        end: new Date('2026-09-25T07:10:00Z'),
        stepSeconds: 300,
      }),
    );

    assert.deepEqual(
      series.map((entry) => entry.labels['service']),
      ['checkout', 'payments'],
    );
  });

  it('extends the baseline before the timeline and stops at the anchor', async () => {
    const series = matrix(
      await prometheus.queryRange({
        query: P99_QUERY.replace('[5m]', '{service="checkout"}[5m]'),
        start: new Date('2026-09-25T04:00:00Z'),
        end: new Date('2026-09-25T09:00:00Z'),
        stepSeconds: 600,
      }),
    );
    const timestamps = series[0]?.samples.map((sample) => sample.timestampMs) ?? [];

    assert.equal(at(series[0], '2026-09-25T04:00:00Z'), 0.2);
    assert.equal(Math.max(...timestamps), ANCHOR.getTime());
  });

  it('evaluates an instant query at the anchor when no time is given', async () => {
    const result = await prometheus.query({ query: P99_QUERY });

    assert.equal(result.data.resultType, PrometheusResultType.Vector);
    if (result.data.resultType === PrometheusResultType.Vector) {
      assert.deepEqual(
        result.data.samples.map((sample) => [sample.labels['service'], sample.sample]),
        [
          ['checkout', { timestampMs: ANCHOR.getTime(), value: 2.2 }],
          ['payments', { timestampMs: ANCHOR.getTime(), value: 0.3 }],
        ],
      );
    }
  });

  it('has no data after the anchor', async () => {
    const result = await prometheus.query({ query: P99_QUERY, time: new Date('2026-09-25T08:00:01Z') });

    assert.deepEqual(result.data, { resultType: PrometheusResultType.Vector, samples: [] });
  });

  it('answers an unmatched query with an empty success, not an error', async () => {
    const series = matrix(
      await prometheus.queryRange({
        query: 'up',
        start: new Date('2026-09-25T06:00:00Z'),
        end: ANCHOR,
        stepSeconds: 60,
      }),
    );

    assert.deepEqual(series, []);
  });

  it('returns identical data for identical requests, and one value per instant across steps', async () => {
    const request = {
      query: 'avg(noisy_metric)',
      start: new Date('2026-09-25T07:00:00Z'),
      end: new Date('2026-09-25T07:30:00Z'),
    };
    const coarse = matrix(await prometheus.queryRange({ ...request, stepSeconds: 300 }));
    const again = matrix(await prometheus.queryRange({ ...request, stepSeconds: 300 }));
    const fine = matrix(await prometheus.queryRange({ ...request, stepSeconds: 15 }));

    assert.deepEqual(coarse, again);
    for (const sample of coarse[0]?.samples ?? []) {
      const sameInstant = fine[0]?.samples.find((candidate) => candidate.timestampMs === sample.timestampMs);
      assert.equal(sameInstant?.value, sample.value);
    }
    assert.ok(new Set(fine[0]?.samples.map((sample) => sample.value)).size > 1, 'noise varies');
  });

  it('rejects more than 11,000 points per series, as Prometheus does (2d at 15s)', async () => {
    await assert.rejects(
      prometheus.queryRange({
        query: P99_QUERY,
        start: new Date('2026-09-23T08:00:00Z'),
        end: ANCHOR,
        stepSeconds: 15,
      }),
      rejectedWith('exceeded maximum resolution of 11,000 points per timeseries'),
    );
  });

  it('rejects an inverted range, an empty query and an oversized query', async () => {
    await assert.rejects(
      prometheus.queryRange({ query: P99_QUERY, start: ANCHOR, end: new Date(0), stepSeconds: 60 }),
      rejectedWith('end timestamp must not be before start time'),
    );
    await assert.rejects(prometheus.query({ query: '  ' }), rejectedWith('no expression found'));
    await assert.rejects(
      prometheus.query({ query: `up${' '.repeat(20_000)}` }),
      rejectedWith('fixture: query exceeds'),
    );
  });

  it('answers unknown endpoints with a 404', () => {
    const response = backend.handle({ method: 'GET', path: '/api/v1/labels', params: new URLSearchParams() });

    assert.equal(response.status, 404);
  });
});
