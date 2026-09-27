import type { ConfigService } from '@nestjs/config';
import { TelemetryBackend } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../errors';
import { isScenarioName, SCENARIO_NAME_PATTERN } from '../fixture/scenario/scenario-name';
import { DatasourceType } from './datasource-type.enum';
import type {
  DirectTelemetryBackend,
  IFixtureDatasourceConfig,
  ITelemetryDatasourceConfig,
} from './telemetry-datasource-config.model';
import { TelemetryEnvVariable } from './telemetry-env-variable.enum';

const MILLIS_PER_MINUTE = 60_000;

const DATASOURCE_TYPE_VARIABLES: Readonly<Record<DirectTelemetryBackend, TelemetryEnvVariable>> = {
  [TelemetryBackend.Prometheus]: TelemetryEnvVariable.PrometheusDatasourceType,
  [TelemetryBackend.Loki]: TelemetryEnvVariable.LokiDatasourceType,
  [TelemetryBackend.Tempo]: TelemetryEnvVariable.TempoDatasourceType,
};

/**
 * An empty variable counts as unset (`||`, not `??`). Everything that can be
 * wrong with the variables fails here, at bootstrap. `now` is a parameter so the
 * default anchor (process start, truncated to the minute) is testable.
 */
export function resolveTelemetryDatasourceConfig(
  config: ConfigService,
  now: Date = new Date(),
): ITelemetryDatasourceConfig {
  const datasources: Record<DirectTelemetryBackend, DatasourceType> = {
    [TelemetryBackend.Prometheus]: resolveType(config, TelemetryBackend.Prometheus),
    [TelemetryBackend.Loki]: resolveType(config, TelemetryBackend.Loki),
    [TelemetryBackend.Tempo]: resolveType(config, TelemetryBackend.Tempo),
  };
  const usesFixture = Object.values(datasources).includes(DatasourceType.Fixture);

  return { datasources, fixture: usesFixture ? resolveFixture(config, now) : undefined };
}

export function backendsOfType(
  config: ITelemetryDatasourceConfig,
  type: DatasourceType,
): DirectTelemetryBackend[] {
  return (Object.keys(config.datasources) as DirectTelemetryBackend[]).filter(
    (backend) => config.datasources[backend] === type,
  );
}

function resolveType(config: ConfigService, backend: DirectTelemetryBackend): DatasourceType {
  const variable = DATASOURCE_TYPE_VARIABLES[backend];
  const value = config.get<string>(variable) || DatasourceType.Http;
  const allowed = Object.values(DatasourceType);

  if (!allowed.includes(value as DatasourceType)) {
    throw invalid(`${variable}='${value}' is not valid; expected one of ${allowed.join(', ')}`);
  }
  return value as DatasourceType;
}

function resolveFixture(config: ConfigService, now: Date): IFixtureDatasourceConfig {
  const scenario = config.get<string>(TelemetryEnvVariable.FixtureScenario) || undefined;

  if (scenario === undefined) {
    throw invalid(`${TelemetryEnvVariable.FixtureScenario} is required when a datasource is a fixture`);
  }
  if (!isScenarioName(scenario)) {
    throw invalid(
      `${TelemetryEnvVariable.FixtureScenario}='${scenario}' must match ${SCENARIO_NAME_PATTERN}`,
    );
  }
  return { scenario, anchor: resolveAnchor(config, now) };
}

function resolveAnchor(config: ConfigService, now: Date): Date {
  const value = config.get<string>(TelemetryEnvVariable.FixtureAnchor) || undefined;

  if (value === undefined) {
    return new Date(Math.floor(now.getTime() / MILLIS_PER_MINUTE) * MILLIS_PER_MINUTE);
  }
  const anchor = new Date(value);

  if (Number.isNaN(anchor.getTime())) {
    throw invalid(`${TelemetryEnvVariable.FixtureAnchor}='${value}' is not an ISO-8601 timestamp`);
  }
  return anchor;
}

function invalid(message: string): TelemetryError {
  return new TelemetryError(TelemetryErrorCode.InvalidDatasourceConfig, message);
}
