export enum TempoApiEndpoint {
  /** Requires a Tempo release with the v2 trace-by-ID API. */
  TraceById = '/api/v2/traces',
  Search = '/api/search',
}

export enum TempoSpanKind {
  Unspecified = 'unspecified',
  Internal = 'internal',
  Server = 'server',
  Client = 'client',
  Producer = 'producer',
  Consumer = 'consumer',
}

export enum TempoStatusCode {
  Unset = 'unset',
  Ok = 'ok',
  Error = 'error',
}
