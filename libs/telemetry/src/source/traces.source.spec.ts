import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { AuthScheme } from '@heimdall/config';
import { TempoStatusCode } from '../connectors/tempo/tempo.enums';
import { TelemetryEnvVariable } from '../datasource/telemetry-env-variable.enum';
import { SPAN_ATTRIBUTE_ALLOWLIST } from '../redaction/span-allowlist';
import { TelemetrySourceModule } from './telemetry-source.module';
import { TracesSource } from './traces.source';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const SOURCE = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 5_000,
  auth: { scheme: AuthScheme.None },
} as const;
const END = new Date(ANCHOR);
const START = new Date(Date.parse(ANCHOR) - 10 * 60_000);

describe('TracesSource on the increased-latency-1 fixture', () => {
  let traces: TracesSource;

  before(async () => {
    process.env[TelemetryEnvVariable.TempoDatasourceType] = 'fixture';
    process.env[TelemetryEnvVariable.FixtureScenario] = 'increased-latency-1';
    process.env[TelemetryEnvVariable.FixtureAnchor] = ANCHOR;
    traces = (await Test.createTestingModule({ imports: [TelemetrySourceModule] }).compile()).get(
      TracesSource,
    );
  });

  after(() => {
    for (const name of [
      TelemetryEnvVariable.TempoDatasourceType,
      TelemetryEnvVariable.FixtureScenario,
      TelemetryEnvVariable.FixtureAnchor,
    ]) {
      delete process.env[name];
    }
  });

  it('keeps only allowlisted attributes of matched spans: the statement text never leaves', async () => {
    const batch = await traces.search(SOURCE, {
      query: '{ resource.service.name="checkout" && span.db.operation.name="UPDATE" }',
      start: START,
      end: END,
      limit: 5,
      spansPerSpanSet: 5,
      component: 'checkout',
    });
    const spans = batch.traces.flatMap((match) => match.spans);
    const names = new Set(spans.flatMap((span) => Object.keys(span.attributes)));

    assert.ok(spans.length > 0);
    assert.equal(spans[0]?.attributes['db.operation.name'], 'UPDATE');
    assert.ok([...names].every((name) => SPAN_ATTRIBUTE_ALLOWLIST.has(name)));
    assert.equal(JSON.stringify(batch.traces).includes('updated_at = now()'), false);
    assert.ok(batch.redaction.droppedFields.includes('db.query.text'));
    assert.equal(batch.redaction.records, spans.length);
  });

  it('returns a whole trace redacted, with its scrubbed status message', async () => {
    const search = await traces.search(SOURCE, {
      query: '{ resource.service.name="checkout" && status=error }',
      start: START,
      end: END,
      limit: 1,
      spansPerSpanSet: 1,
      component: 'checkout',
    });
    const traceId = search.traces[0]?.traceId ?? '';
    const { trace, redaction } = await traces.trace(SOURCE, { traceId, component: 'checkout' });
    const failed = trace?.spans.find(
      (span) => span.status.code === TempoStatusCode.Error && span.status.message !== undefined,
    );

    assert.ok(trace !== undefined && trace.spans.length > 1);
    assert.match(failed?.status.message ?? '', /pool exhausted/);
    assert.equal(redaction.records, trace.spans.length);
    assert.equal(
      trace.spans.every((span) =>
        Object.keys(span.attributes).every((name) => SPAN_ATTRIBUTE_ALLOWLIST.has(name)),
      ),
      true,
    );
  });

  it('answers an unknown trace with nothing rather than an error', async () => {
    const { trace } = await traces.trace(SOURCE, {
      traceId: '0'.repeat(32),
      component: 'checkout',
    });

    assert.equal(trace, undefined);
  });
});
