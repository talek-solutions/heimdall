// Provider-neutral surface. The raw connectors are not exported: the engine reads telemetry
// only through the redacting sources below (ADR 0008).
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

// Redacting sources for the engine (ADR 0008).
export { MetricsSource } from './source/metrics.source';
export type * from './source/metrics-source.interface';
export { LogsSource } from './source/logs.source';
export type * from './source/logs-source.interface';
export { TracesSource } from './source/traces.source';
export type * from './source/traces-source.interface';
export { TelemetrySourceModule } from './source/telemetry-source.module';
export { TelemetrySignal, TelemetrySpanName } from './source/telemetry-source.enums';
export { TempoSpanKind, TempoStatusCode } from './connectors/tempo/tempo.enums';

// Redaction: what the sources apply, and the shapes they report it in.
export type { RedactedText } from './redaction/redacted-text';
export { LogLineFormat } from './redaction/log-line.parser';
export { mergeRedaction, type IRedactionSummary } from './redaction/redaction-tally';
export { RedactionMetric } from './redaction/redaction.enums';
export { redactionToken, SCRUBBER_ORDER, SCRUBBER_PATTERNS } from './redaction/scrubbers';
export { SPAN_ATTRIBUTE_ALLOWLIST } from './redaction/span-allowlist';
