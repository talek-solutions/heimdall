export enum ScenarioVersion {
  V1 = 1,
}

/** Only the manifest is required; a missing signal file means that signal has no data. */
export enum ScenarioFile {
  Manifest = 'scenario.yaml',
  Metrics = 'metrics.yaml',
  Logs = 'logs.yaml',
  Traces = 'traces.yaml',
}
