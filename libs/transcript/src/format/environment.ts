const PREFIXES = ['INVESTIGATION_', 'AGENT_', 'TELEMETRY_FIXTURE_'];
const NAMES = new Set([
  'PROMETHEUS_DATASOURCE_TYPE',
  'LOKI_DATASOURCE_TYPE',
  'TEMPO_DATASOURCE_TYPE',
]);
/** Defence in depth: even an allowlisted name is dropped if it looks like a credential. */
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

/** Whether a variable shapes a run and may be kept in a transcript. */
export function isRecordedVariable(name: string): boolean {
  return (
    (NAMES.has(name) || PREFIXES.some((prefix) => name.startsWith(prefix))) && !SECRET.test(name)
  );
}

/** The variables a run depended on, sorted, empty values left out. */
export function recordedVariables(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
      .filter(([name]) => isRecordedVariable(name))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
