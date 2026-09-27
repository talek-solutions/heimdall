export enum TelemetryEnvVariable {
  PrometheusDatasourceType = 'PROMETHEUS_DATASOURCE_TYPE',
  LokiDatasourceType = 'LOKI_DATASOURCE_TYPE',
  TempoDatasourceType = 'TEMPO_DATASOURCE_TYPE',
  /** Directory name under `libs/telemetry/scenarios`. */
  FixtureScenario = 'TELEMETRY_FIXTURE_SCENARIO',
  /** ISO-8601 end of the scenario timeline; defaults to process start. */
  FixtureAnchor = 'TELEMETRY_FIXTURE_ANCHOR',
}
