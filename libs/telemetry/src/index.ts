// Provider-neutral surface. Backend connectors live under './connectors'.
export type { IConnectorSource } from './connectors/connector-source.type';
export { TelemetryError, TelemetryErrorCode } from './errors';

// Datasource selection only; no data flows through these.
export { DatasourceType } from './datasource/datasource-type.enum';
export { TelemetryEnvVariable } from './datasource/telemetry-env-variable.enum';
export type {
  DirectTelemetryBackend,
  IFixtureDatasourceConfig,
  ITelemetryDatasourceConfig,
} from './datasource/telemetry-datasource-config.model';
export {
  backendsOfType,
  resolveTelemetryDatasourceConfig,
} from './datasource/telemetry-datasource-config.resolver';
export { TELEMETRY_DATASOURCE_CONFIG } from './datasource/telemetry-datasource.tokens';
export { TelemetryDatasourceConfigModule } from './datasource/telemetry-datasource-config.module';
