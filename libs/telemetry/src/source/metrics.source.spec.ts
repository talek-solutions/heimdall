import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { AuthScheme } from '@heimdall/config';
import { TelemetryEnvVariable } from '../datasource/telemetry-env-variable.enum';
import { TelemetryError } from '../errors';
import { MetricsSource } from './metrics.source';
import { TelemetrySourceModule } from './telemetry-source.module';
import { TelemetrySpanAttribute } from './telemetry-source.enums';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const SOURCE = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 1_000,
  auth: { scheme: AuthScheme.None },
} as const;
const ERROR_RATIO =
  'sum(rate(http_server_request_duration_seconds_count{service="checkout",http_response_status_code=~"5.."}[1m])) / sum(rate(http_server_request_duration_seconds_count{service="checkout"}[1m]))';

describe('MetricsSource on the error-burst-30s fixture', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  let metrics: MetricsSource;

  before(async () => {
    trace.setGlobalTracerProvider(provider);
    process.env[TelemetryEnvVariable.PrometheusDatasourceType] = 'fixture';
    process.env[TelemetryEnvVariable.FixtureScenario] = 'error-burst-30s';
    process.env[TelemetryEnvVariable.FixtureAnchor] = ANCHOR;
    const moduleRef = await Test.createTestingModule({
      imports: [TelemetrySourceModule],
    }).compile();
    metrics = moduleRef.get(MetricsSource);
  });

  after(async () => {
    for (const name of [
      TelemetryEnvVariable.PrometheusDatasourceType,
      TelemetryEnvVariable.FixtureScenario,
      TelemetryEnvVariable.FixtureAnchor,
    ]) {
      delete process.env[name];
    }
    await provider.shutdown();
  });

  it('returns typed points and only the allowlisted labels', async () => {
    const [series, ...rest] = await metrics.queryRange(SOURCE, {
      query: ERROR_RATIO,
      start: new Date(Date.parse(ANCHOR) - 60_000),
      end: new Date(ANCHOR),
      stepSeconds: 1,
      labels: ['service'],
    });
    const burst = series?.points.find((point) => point.timestampMs === Date.parse(ANCHOR) - 24_000);

    assert.equal(rest.length, 0);
    assert.deepEqual(series?.labels, { service: 'checkout' });
    assert.equal(series?.points.length, 61);
    assert.ok((burst?.value ?? 0) > 0.15, `the burst at T-24s: ${burst?.value}`);
  });

  it('records a telemetry.query span with counts and the query text, never values', async () => {
    exporter.reset();
    await metrics.queryRange(SOURCE, {
      query: ERROR_RATIO,
      start: new Date(Date.parse(ANCHOR) - 10_000),
      end: new Date(ANCHOR),
      stepSeconds: 1,
      labels: [],
    });
    const [span] = exporter.getFinishedSpans();

    assert.equal(span?.name, 'telemetry.query prometheus');
    assert.equal(span?.attributes[TelemetrySpanAttribute.QueryText], ERROR_RATIO);
    assert.equal(span?.attributes[TelemetrySpanAttribute.Series], 1);
    assert.equal(span?.attributes[TelemetrySpanAttribute.Points], 11);
    assert.equal(JSON.stringify(span?.attributes).includes('0.19'), false);
  });

  it('marks a rejected query on its span by error code, and rethrows', async () => {
    exporter.reset();
    await assert.rejects(
      metrics.queryRange(SOURCE, {
        query: ERROR_RATIO,
        start: new Date(ANCHOR),
        end: new Date(Date.parse(ANCHOR) - 1_000),
        stepSeconds: 1,
        labels: [],
      }),
      (error: unknown) => error instanceof TelemetryError,
    );
    const [span] = exporter.getFinishedSpans();

    assert.equal(typeof span?.attributes[TelemetrySpanAttribute.ErrorType], 'string');
    assert.equal(span?.status.message, span?.attributes[TelemetrySpanAttribute.ErrorType]);
  });
});
