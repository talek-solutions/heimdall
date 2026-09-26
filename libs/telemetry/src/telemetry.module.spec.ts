import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Test } from '@nestjs/testing';
import { AuthScheme } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from './errors';
import { LokiConnector } from './connectors/loki/loki.connector';
import { PrometheusConnector } from './connectors/prometheus/prometheus.connector';
import { TelemetryConnectorFactory } from './connectors/telemetry-connector.factory';
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
