/**
 * The span attributes that may leave (ADR 0008): OpenTelemetry semantic conventions that name an
 * operation, never its payload. `db.query.text`, `url.*` beyond the scheme, `user_agent.*`,
 * `enduser.*`, `client.address` and `exception.stacktrace` are deliberately absent.
 */
export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  'service.name',
  'http.request.method',
  'http.route',
  'http.response.status_code',
  'url.scheme',
  'server.address',
  'server.port',
  'rpc.system',
  'rpc.service',
  'rpc.method',
  'db.system',
  'db.system.name',
  'db.namespace',
  'db.operation.name',
  'db.collection.name',
  'db.response.status_code',
  'messaging.system',
  'messaging.operation.type',
  'messaging.destination.name',
  'messaging.consumer.group.name',
  'error.type',
]);

/** The one span event kept, and the attributes of it that may leave. */
export const EXCEPTION_EVENT = 'exception';

export enum ExceptionAttribute {
  Type = 'exception.type',
  Message = 'exception.message',
}

export const EXCEPTION_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set(
  Object.values(ExceptionAttribute),
);
