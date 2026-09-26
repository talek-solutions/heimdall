export enum TelemetryBackend {
  Loki = 'loki',
  Prometheus = 'prometheus',
  Tempo = 'tempo',
  /** Queried through Grafana's datasource proxy rather than the backend directly. */
  Grafana = 'grafana',
}
