import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { metrics, trace } from '@opentelemetry/api';
import {
  MeterProvider,
  MetricReader,
  type DataPoint,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { AuthScheme, FieldSemantic, Scrubber } from '@heimdall/config';
import { TelemetryEnvVariable } from '../datasource/telemetry-env-variable.enum';
import { LogLineFormat } from '../redaction/log-line.parser';
import { RedactionAttribute, RedactionMetric } from '../redaction/redaction.enums';
import { LogsSource } from './logs.source';
import { MASKED_FILTER } from './query-span';
import { TelemetrySourceModule } from './telemetry-source.module';
import { TelemetrySpanAttribute, TelemetrySpanName } from './telemetry-source.enums';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const SOURCE = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 5_000,
  auth: { scheme: AuthScheme.None },
} as const;
const END = new Date(ANCHOR);
const START = new Date(Date.parse(ANCHOR) - 60 * 60_000);
const CHECKOUT_FIELDS = { level: FieldSemantic.Severity, msg: FieldSemantic.Message };
/** The planted values of increased-latency-1/logs.yaml (documented examples and fakes). */
const PLANTED = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 's3cr3t-Passw0rd', 'jane.doe@example.com'];

class CollectingReader extends MetricReader {
  protected override async onForceFlush(): Promise<void> {}
  protected override async onShutdown(): Promise<void> {}
}

function exported(spans: readonly ReadableSpan[], collected: ResourceMetrics): string {
  return JSON.stringify({
    spans: spans.map(({ name, attributes, events, status }) => ({
      name,
      attributes,
      events,
      status,
    })),
    metrics: collected.scopeMetrics.flatMap(({ metrics: list }) =>
      list.map(({ descriptor, dataPoints }) => ({ name: descriptor.name, dataPoints })),
    ),
  });
}

function sumOf(collected: ResourceMetrics, name: RedactionMetric, scrubber?: string): number {
  return collected.scopeMetrics
    .flatMap(({ metrics: list }) => list)
    .filter(({ descriptor }) => descriptor.name === name)
    .flatMap(({ dataPoints }) => dataPoints as readonly DataPoint<number>[])
    .filter(
      ({ attributes }) =>
        scrubber === undefined || attributes[RedactionAttribute.Scrubber] === scrubber,
    )
    .reduce((total, { value }) => total + value, 0);
}

describe('LogsSource on the increased-latency-1 fixture', () => {
  const exporter = new InMemorySpanExporter();
  const reader = new CollectingReader();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const meterProvider = new MeterProvider({ readers: [reader] });
  let logs: LogsSource;

  before(async () => {
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
    process.env[TelemetryEnvVariable.LokiDatasourceType] = 'fixture';
    process.env[TelemetryEnvVariable.FixtureScenario] = 'increased-latency-1';
    process.env[TelemetryEnvVariable.FixtureAnchor] = ANCHOR;
    logs = (await Test.createTestingModule({ imports: [TelemetrySourceModule] }).compile()).get(
      LogsSource,
    );
  });

  beforeEach(() => exporter.reset());

  after(async () => {
    for (const name of [
      TelemetryEnvVariable.LokiDatasourceType,
      TelemetryEnvVariable.FixtureScenario,
      TelemetryEnvVariable.FixtureAnchor,
    ]) {
      delete process.env[name];
    }
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
  });

  it('keeps only mapped fields, under their meaning, and drops the rest by count', async () => {
    const batch = await logs.queryRange(SOURCE, {
      query: '{service_name="checkout"}',
      start: START,
      end: END,
      limit: 300,
      fields: CHECKOUT_FIELDS,
      component: 'checkout',
    });
    const keys = new Set(batch.records.flatMap((record) => Object.keys(record.fields)));

    assert.equal(batch.records.length, 300);
    assert.deepEqual([...keys].sort(), [FieldSemantic.Message, FieldSemantic.Severity]);
    assert.equal(batch.redaction.records, 300);
    assert.ok(batch.redaction.fieldsDropped > 300);
    assert.ok(batch.redaction.droppedFields.includes('order_id'));
    assert.ok(
      batch.records.every(
        (record, index) =>
          index === 0 || (batch.records[index - 1]?.timestampMs ?? 0) <= record.timestampMs,
      ),
      'oldest first',
    );
  });

  it('scrubs mapped fields that carry secrets, and counts each match', async () => {
    const collect = async (filter: string, fields: Readonly<Record<string, string>>) =>
      logs.queryRange(SOURCE, {
        query: `{service_name="checkout"} |= "${filter}"`,
        start: START,
        end: END,
        limit: 20,
        fields,
        component: 'checkout',
      });
    const bearer = await collect('token refresh failed', { authorization: 'authorization' });
    const dsn = await collect('db connect failed', { dsn: 'dsn' });
    const text = JSON.stringify([bearer.records, dsn.records]);

    assert.ok(bearer.records.length > 0 && dsn.records.length > 0);
    assert.equal(bearer.records[0]?.fields['authorization'], 'Bearer [REDACTED:bearerToken]');
    assert.match(
      dsn.records[0]?.fields['dsn'] ?? '',
      /^postgres:\/\/\[REDACTED:connectionString\]@orders-pg/,
    );
    assert.equal(bearer.redaction.matches[Scrubber.BearerToken], bearer.records.length);
    for (const planted of PLANTED) {
      assert.equal(text.includes(planted), false, planted);
    }
  });

  it('reads an unstructured line as its message', async () => {
    const batch = await logs.queryRange(SOURCE, {
      query: '{service_name="orders-pg"} |= "ShareLock"',
      start: new Date(Date.parse(ANCHOR) - 10 * 60_000),
      end: END,
      limit: 5,
      fields: {},
      component: 'orders-pg',
    });

    assert.equal(batch.records[0]?.format, LogLineFormat.Unstructured);
    assert.match(
      batch.records[0]?.fields[FieldSemantic.Message] ?? '',
      /still waiting for ShareLock/,
    );
    assert.equal(batch.redaction.fieldsDropped, 0);
  });

  it('counts redaction on a span and the counters, and never exports a value or a dropped name', async () => {
    const batch = await logs.queryRange(SOURCE, {
      query: '{service_name="checkout"} |= "token refresh failed"',
      start: START,
      end: END,
      limit: 20,
      fields: { authorization: 'authorization', msg: FieldSemantic.Message },
      component: 'checkout',
    });
    const spans = exporter.getFinishedSpans();
    const query = spans.find((span) => span.name.startsWith(TelemetrySpanName.Query));
    const redact = spans.find((span) => span.name === TelemetrySpanName.Redact);
    const { resourceMetrics } = await reader.collect();
    const text = exported(spans, resourceMetrics);

    assert.equal(
      query?.attributes[TelemetrySpanAttribute.QueryText],
      `{service_name="checkout"} |= ${MASKED_FILTER}`,
    );
    assert.equal(redact?.attributes[RedactionAttribute.Records], batch.records.length);
    assert.equal(
      redact?.attributes[RedactionAttribute.FieldsDropped],
      batch.redaction.fieldsDropped,
    );
    assert.equal(
      redact?.attributes[`${RedactionAttribute.Matches}.${Scrubber.BearerToken}`],
      batch.records.length,
    );
    assert.ok(
      sumOf(resourceMetrics, RedactionMetric.Matches, Scrubber.BearerToken) >= batch.records.length,
    );
    assert.ok(
      sumOf(resourceMetrics, RedactionMetric.FieldsDropped) >= batch.redaction.fieldsDropped,
    );
    for (const leaked of [
      ...PLANTED,
      'token refresh failed',
      'level',
      ...batch.redaction.droppedFields,
    ]) {
      assert.equal(text.includes(leaked), false, leaked);
    }
  });
});
