export enum LokiApiEndpoint {
  Query = '/loki/api/v1/query',
  QueryRange = '/loki/api/v1/query_range',
}

export enum LokiDirection {
  Forward = 'forward',
  Backward = 'backward',
}

export enum LokiResultType {
  /** Log queries. */
  Streams = 'streams',
  /** Metric range queries. */
  Matrix = 'matrix',
  /** Metric instant queries. */
  Vector = 'vector',
}
