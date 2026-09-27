import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { TelemetryBackend } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../errors';
import { DatasourceType } from './datasource-type.enum';
import {
  backendsOfType,
  resolveTelemetryDatasourceConfig,
} from './telemetry-datasource-config.resolver';
import { TelemetryEnvVariable } from './telemetry-env-variable.enum';

const NOW = new Date('2026-09-25T08:17:42.500Z');

function isInvalidConfig(...fragments: string[]): (error: unknown) => boolean {
  return (error) =>
    error instanceof TelemetryError &&
    error.errorCode === TelemetryErrorCode.InvalidDatasourceConfig &&
    fragments.every((fragment) => error.message.includes(fragment));
}

describe('resolveTelemetryDatasourceConfig', () => {
  // ConfigService reads process.env first, so the developer's shell must not leak in.
  const saved: Partial<Record<TelemetryEnvVariable, string | undefined>> = {};

  beforeEach(() => {
    for (const name of Object.values(TelemetryEnvVariable)) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of Object.values(TelemetryEnvVariable)) {
      const value = saved[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('defaults every backend to http and needs no fixture settings', () => {
    const config = resolveTelemetryDatasourceConfig(new ConfigService(), NOW);

    assert.deepEqual(config, {
      datasources: {
        [TelemetryBackend.Prometheus]: DatasourceType.Http,
        [TelemetryBackend.Loki]: DatasourceType.Http,
        [TelemetryBackend.Tempo]: DatasourceType.Http,
      },
      fixture: undefined,
    });
  });

  it('ignores fixture settings while no backend is a fixture', () => {
    const config = resolveTelemetryDatasourceConfig(
      new ConfigService({
        [TelemetryEnvVariable.FixtureScenario]: '../escape',
        [TelemetryEnvVariable.FixtureAnchor]: 'not-a-date',
      }),
      NOW,
    );

    assert.equal(config.fixture, undefined);
  });

  it('selects the datasource per backend', () => {
    const config = resolveTelemetryDatasourceConfig(
      new ConfigService({
        [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
        [TelemetryEnvVariable.LokiDatasourceType]: 'http',
        [TelemetryEnvVariable.FixtureScenario]: 'increased-latency-1',
      }),
      NOW,
    );

    assert.equal(config.datasources[TelemetryBackend.Prometheus], DatasourceType.Fixture);
    assert.equal(config.datasources[TelemetryBackend.Loki], DatasourceType.Http);
    assert.equal(config.datasources[TelemetryBackend.Tempo], DatasourceType.Http);
    assert.deepEqual(backendsOfType(config, DatasourceType.Fixture), [TelemetryBackend.Prometheus]);
    assert.equal(config.fixture?.scenario, 'increased-latency-1');
  });

  it('anchors at process start truncated to the minute by default', () => {
    const config = resolveTelemetryDatasourceConfig(
      new ConfigService({
        [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
        [TelemetryEnvVariable.FixtureScenario]: 'healthy-baseline',
      }),
      NOW,
    );

    assert.equal(config.fixture?.anchor.toISOString(), '2026-09-25T08:17:00.000Z');
  });

  it('reads a pinned anchor from process.env', () => {
    process.env[TelemetryEnvVariable.LokiDatasourceType] = 'fixture';
    process.env[TelemetryEnvVariable.FixtureScenario] = 'healthy-baseline';
    process.env[TelemetryEnvVariable.FixtureAnchor] = '2026-01-01T00:00:00Z';

    const config = resolveTelemetryDatasourceConfig(new ConfigService(), NOW);

    assert.equal(config.fixture?.anchor.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  it('treats the empty string as unset', () => {
    const config = resolveTelemetryDatasourceConfig(
      new ConfigService({ [TelemetryEnvVariable.PrometheusDatasourceType]: '' }),
      NOW,
    );

    assert.equal(config.datasources[TelemetryBackend.Prometheus], DatasourceType.Http);
  });

  it('rejects an unknown datasource type', () => {
    assert.throws(
      () =>
        resolveTelemetryDatasourceConfig(
          new ConfigService({ [TelemetryEnvVariable.PrometheusDatasourceType]: 'mock' }),
          NOW,
        ),
      isInvalidConfig('PROMETHEUS_DATASOURCE_TYPE', 'http, fixture'),
    );
  });

  it('requires a scenario once a backend is a fixture', () => {
    assert.throws(
      () =>
        resolveTelemetryDatasourceConfig(
          new ConfigService({ [TelemetryEnvVariable.LokiDatasourceType]: 'fixture' }),
          NOW,
        ),
      isInvalidConfig('TELEMETRY_FIXTURE_SCENARIO'),
    );
  });

  it('rejects a scenario name that could reshape the path', () => {
    assert.throws(
      () =>
        resolveTelemetryDatasourceConfig(
          new ConfigService({
            [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
            [TelemetryEnvVariable.FixtureScenario]: '../../etc',
          }),
          NOW,
        ),
      isInvalidConfig('TELEMETRY_FIXTURE_SCENARIO', '../../etc'),
    );
  });

  it('rejects a malformed anchor', () => {
    assert.throws(
      () =>
        resolveTelemetryDatasourceConfig(
          new ConfigService({
            [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
            [TelemetryEnvVariable.FixtureScenario]: 'healthy-baseline',
            [TelemetryEnvVariable.FixtureAnchor]: 'yesterday',
          }),
          NOW,
        ),
      isInvalidConfig('TELEMETRY_FIXTURE_ANCHOR', 'yesterday'),
    );
  });
});
