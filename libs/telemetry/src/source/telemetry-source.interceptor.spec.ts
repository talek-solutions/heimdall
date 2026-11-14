import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthScheme, FieldSemantic } from '@heimdall/config';
import { TelemetryEnvVariable } from '../datasource/telemetry-env-variable.enum';
import { LogsSource } from './logs.source';
import { MetricsSource } from './metrics.source';
import {
  TelemetryOperation,
  type ITelemetryCall,
  type ITelemetrySourceInterceptor,
} from './telemetry-source.interceptor';
import { TelemetrySourceModule } from './telemetry-source.module';
import { TELEMETRY_SOURCE_INTERCEPTOR } from './telemetry-source.tokens';
import { TracesSource } from './traces.source';

const ANCHOR = '2026-10-17T08:00:00.000Z';
const SOURCE = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 5_000,
  auth: { scheme: AuthScheme.None },
} as const;
const END = new Date(ANCHOR);
const START = new Date(END.getTime() - 60 * 60_000);
const ENV = {
  [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
  [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
  [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
  [TelemetryEnvVariable.FixtureScenario]: 'increased-latency-1',
  [TelemetryEnvVariable.FixtureAnchor]: ANCHOR,
};
const SERVED = { resultIds: ['r7'] };

class Watching implements ITelemetrySourceInterceptor {
  readonly calls: ITelemetryCall[] = [];

  intercept<T>(call: ITelemetryCall, run: () => Promise<T>): Promise<T> {
    this.calls.push(call);
    return run();
  }
}

const watching = new Watching();

@Global()
@Module({
  providers: [{ provide: TELEMETRY_SOURCE_INTERCEPTOR, useValue: watching }],
  exports: [TELEMETRY_SOURCE_INTERCEPTOR],
})
class WatchingModule {}

describe('A source call says which results it serves (ADR 0020)', () => {
  let metrics: MetricsSource;
  let logs: LogsSource;
  let traces: TracesSource;

  before(async () => {
    Object.assign(process.env, ENV);
    const moduleRef = await Test.createTestingModule({
      imports: [WatchingModule, TelemetrySourceModule],
    }).compile();

    metrics = moduleRef.get(MetricsSource);
    logs = moduleRef.get(LogsSource);
    traces = moduleRef.get(TracesSource);
  });

  after(() => {
    for (const name of Object.keys(ENV)) {
      delete process.env[name];
    }
  });

  /** The call made twice, with and without the context: only `resultIds` may differ. */
  async function both<T>(
    operation: TelemetryOperation,
    run: (context?: typeof SERVED) => Promise<T>,
  ): Promise<void> {
    watching.calls.length = 0;
    const plain = await run();
    const served = await run(SERVED);
    const [first, second] = watching.calls;

    assert.equal(watching.calls.length, 2);
    assert.equal(first?.operation, operation);
    assert.equal('resultIds' in (first ?? {}), false);
    assert.deepEqual(second?.resultIds, ['r7']);
    assert.deepEqual({ ...second, resultIds: undefined }, { ...first, resultIds: undefined });
    assert.deepEqual(served, plain);
  }

  it('metrics.queryRange', async () => {
    await both(TelemetryOperation.MetricsQueryRange, (context) =>
      metrics.queryRange(
        SOURCE,
        { query: 'up', start: START, end: END, stepSeconds: 60, labels: [] },
        context,
      ),
    );
  });

  it('logs.queryRange', async () => {
    await both(TelemetryOperation.LogsQueryRange, (context) =>
      logs.queryRange(
        SOURCE,
        {
          query: '{service_name="checkout"}',
          start: START,
          end: END,
          limit: 5,
          fields: { level: FieldSemantic.Severity, msg: FieldSemantic.Message },
          component: 'checkout',
        },
        context,
      ),
    );
  });

  it('traces.search and traces.trace', async () => {
    const query = '{ resource.service.name="checkout" && status=error }';
    const request = { query, start: START, end: END, limit: 1, spansPerSpanSet: 1 };
    const found = await traces.search(SOURCE, { ...request, component: 'checkout' });
    const traceId = found.traces[0]?.traceId ?? '';

    assert.notEqual(traceId, '');
    await both(TelemetryOperation.TracesSearch, (context) =>
      traces.search(SOURCE, { ...request, component: 'checkout' }, context),
    );
    await both(TelemetryOperation.TracesTrace, (context) =>
      traces.trace(SOURCE, { traceId, component: 'checkout' }, context),
    );
  });
});
