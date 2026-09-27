import 'reflect-metadata';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { AuthScheme } from '@heimdall/config';
import { TelemetryEnvVariable } from './datasource/telemetry-env-variable.enum';
import { TelemetryError, TelemetryErrorCode } from './errors';
import { LokiConnector } from './connectors/loki/loki.connector';
import { PrometheusConnector } from './connectors/prometheus/prometheus.connector';
import { TelemetryConnectorFactory } from './connectors/telemetry-connector.factory';
import { LokiResultType } from './connectors/loki/loki.enums';
import { PrometheusResultType } from './connectors/prometheus/prometheus.enums';
import { TempoStatusCode } from './connectors/tempo/tempo.enums';
import { TempoConnector } from './connectors/tempo/tempo.connector';
import type { IConnectorSource } from './connectors/connector-source.type';
import { TelemetryModule } from './telemetry.module';

const TOKEN_ENV = 'HEIMDALL_TEST_TELEMETRY_TOKEN';

// Port 9 (discard) on loopback: the request never gets far enough to matter.
const source: IConnectorSource = {
  url: 'http://127.0.0.1:9',
  timeoutMs: 1_000,
  auth: { scheme: AuthScheme.Bearer, tokenEnv: TOKEN_ENV },
};

async function factory(): Promise<TelemetryConnectorFactory> {
  const moduleRef = await Test.createTestingModule({ imports: [TelemetryModule] }).compile();
  return moduleRef.get(TelemetryConnectorFactory);
}

describe('TelemetryModule', () => {
  it('builds a connector per backend', async () => {
    const connectors = await factory();

    assert.ok(connectors.loki(source) instanceof LokiConnector);
    assert.ok(connectors.prometheus(source) instanceof PrometheusConnector);
    assert.ok(connectors.tempo(source) instanceof TempoConnector);
  });

  it('builds connectors without credentials, deferring the check to the first query', async () => {
    delete process.env[TOKEN_ENV];
    const loki = (await factory()).loki(source);

    await assert.rejects(
      loki.query({ query: '{}' }),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.MissingCredentials &&
        error.message.includes(TOKEN_ENV),
    );
  });

  it('reads credentials through ConfigService, i.e. from process.env', async () => {
    process.env[TOKEN_ENV] = 'from-env';
    try {
      const loki = (await factory()).loki(source);

      // Credentials resolve, so the failure is now the unreachable port, not MISSING_CREDENTIALS.
      await assert.rejects(
        loki.query({ query: '{}' }),
        (error: unknown) =>
          error instanceof TelemetryError && error.errorCode !== TelemetryErrorCode.MissingCredentials,
      );
    } finally {
      delete process.env[TOKEN_ENV];
    }
  });
});

describe('TelemetryModule with fixture datasources', () => {
  const ANCHOR = '2026-09-25T08:00:00.000Z';
  const saved: Partial<Record<TelemetryEnvVariable, string | undefined>> = {};

  function setEnv(values: Partial<Record<TelemetryEnvVariable, string>>): void {
    for (const name of Object.values(TelemetryEnvVariable)) {
      saved[name] ??= process.env[name];
      const value = values[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }

  afterEach(() => {
    for (const name of Object.values(TelemetryEnvVariable)) {
      const value = saved[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
      delete saved[name];
    }
  });

  it('answers from the scenario with no network and no credentials', async () => {
    delete process.env[TOKEN_ENV];
    setEnv({
      [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
      [TelemetryEnvVariable.FixtureScenario]: 'increased-latency-1',
      [TelemetryEnvVariable.FixtureAnchor]: ANCHOR,
    });
    const prometheus = (await factory()).prometheus(source);
    const request = {
      query:
        'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="checkout"}[5m])))',
      start: new Date('2026-09-25T06:00:00.000Z'),
      end: new Date(ANCHOR),
      stepSeconds: 60,
    };

    const result = await prometheus.queryRange(request);
    const again = await (await factory()).prometheus(source).queryRange(request);

    assert.ok(prometheus instanceof PrometheusConnector);
    assert.deepEqual(result, again);
    assert.equal(result.data.resultType, PrometheusResultType.Matrix);
    if (result.data.resultType === PrometheusResultType.Matrix) {
      const samples = result.data.series[0]?.samples ?? [];
      const before = samples.find((sample) => sample.timestampMs === Date.parse('2026-09-25T07:20:00Z'));
      const during = samples.find((sample) => sample.timestampMs === Date.parse('2026-09-25T07:50:00Z'));
      assert.equal(result.data.series.length, 1);
      assert.ok((before?.value ?? Infinity) < 0.3, `before the ramp: ${before?.value}`);
      assert.ok((during?.value ?? 0) > 2, `after the ramp: ${during?.value}`);
    }
  });

  it('links signals: a trace ID in a fixture log line is a trace the Tempo fixture serves', async () => {
    delete process.env[TOKEN_ENV];
    setEnv({
      [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
      [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
      [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
      [TelemetryEnvVariable.FixtureScenario]: 'increased-latency-1',
      [TelemetryEnvVariable.FixtureAnchor]: ANCHOR,
    });
    const connectors = await factory();

    const logs = await connectors.loki(source).queryRange({
      query: '{service_name="checkout", level="error"} |= "pool exhausted"',
      start: new Date('2026-09-25T07:50:00.000Z'),
      end: new Date(ANCHOR),
      limit: 20,
    });
    assert.equal(logs.resultType, LokiResultType.Streams);
    const line = logs.resultType === LokiResultType.Streams ? logs.streams[0]?.entries[0]?.line : undefined;
    const traceId = /trace_id=([0-9a-f]{32})/.exec(line ?? '')?.[1];
    assert.ok(traceId !== undefined, `no trace_id in: ${line}`);

    const trace = await connectors.tempo(source).getTrace({ traceId });
    const update = trace?.spans.find((span) => span.name === 'UPDATE orders');
    assert.equal(update?.status.code, TempoStatusCode.Error);
    assert.match(update?.status.message ?? '', /pool exhausted/);

    const errors = await connectors.tempo(source).search({
      query: '{ status = error && span.db.system = "postgresql" }',
      start: new Date('2026-09-25T07:50:00.000Z'),
      end: new Date(ANCHOR),
    });
    assert.ok(errors.traces.length > 0);
    assert.ok(errors.traces.every((summary) => summary.rootServiceName === 'checkout'));
  });

  it('keeps the other backends on http', async () => {
    delete process.env[TOKEN_ENV];
    setEnv({
      [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
      [TelemetryEnvVariable.FixtureScenario]: 'healthy-baseline',
    });
    const loki = (await factory()).loki(source);

    await assert.rejects(
      loki.query({ query: '{}' }),
      (error: unknown) =>
        error instanceof TelemetryError && error.errorCode === TelemetryErrorCode.MissingCredentials,
    );
  });

  it('fails at bootstrap when the scenario does not exist', async () => {
    setEnv({
      [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
      [TelemetryEnvVariable.FixtureScenario]: 'no-such-scenario',
    });

    await assert.rejects(
      factory(),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.FixtureScenarioNotFound,
    );
  });

  it('fails at bootstrap on an invalid datasource type', async () => {
    setEnv({ [TelemetryEnvVariable.LokiDatasourceType]: 'replay' });

    await assert.rejects(
      factory(),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.InvalidDatasourceConfig,
    );
  });
});
