export enum PrometheusApiEndpoint {
  Query = '/api/v1/query',
  QueryRange = '/api/v1/query_range',
}

export enum PrometheusResponseStatus {
  Success = 'success',
  Error = 'error',
}

export enum PrometheusResultType {
  Vector = 'vector',
  Matrix = 'matrix',
  Scalar = 'scalar',
  String = 'string',
}
