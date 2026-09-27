/** `TELEMETRY_`-prefixed so the CLI can group codes by string value without collisions. */
export enum TelemetryErrorCode {
  /** A referenced credential env var is unset or empty. */
  MissingCredentials = 'TELEMETRY_MISSING_CREDENTIALS',
  /** HTTP 401/403. */
  AuthenticationFailed = 'TELEMETRY_AUTHENTICATION_FAILED',
  /** HTTP 429. */
  RateLimited = 'TELEMETRY_RATE_LIMITED',
  /** HTTP 400/422 or a backend `status: "error"`; carries the backend's reason. */
  QueryRejected = 'TELEMETRY_QUERY_REJECTED',
  /** Any other non-2xx. */
  RequestFailed = 'TELEMETRY_REQUEST_FAILED',
  /** The source's `timeoutMs` elapsed. */
  Timeout = 'TELEMETRY_TIMEOUT',
  /** No HTTP response at all (DNS, TLS, socket, abort). */
  NetworkError = 'TELEMETRY_NETWORK_ERROR',
  /** 2xx with a body this lib cannot interpret. */
  InvalidResponse = 'TELEMETRY_INVALID_RESPONSE',
  /** A `*_DATASOURCE_TYPE` or `TELEMETRY_FIXTURE_*` variable is invalid, or a fixture has no scenario. */
  InvalidDatasourceConfig = 'TELEMETRY_INVALID_DATASOURCE_CONFIG',
  /** No fixture scenario directory with the configured name. */
  FixtureScenarioNotFound = 'TELEMETRY_FIXTURE_SCENARIO_NOT_FOUND',
  /** A scenario file fails to parse or validate; the message names the file and field. */
  FixtureScenarioInvalid = 'TELEMETRY_FIXTURE_SCENARIO_INVALID',
}
