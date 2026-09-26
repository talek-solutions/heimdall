# Telemetry connectors

Read-only HTTP connectors for the Grafana stack (ADR 0009). Implemented in `libs/telemetry`
and exported from `@heimdall/telemetry/connectors`.

> **Results are not redacted.** See the ADR 0008 amendment before passing any of them to a model.

## Input: only what a connector needs

Each connector takes `IConnectorSource`, which is `Pick<ISourceConfig, 'url' | 'timeoutMs' | 'auth'>`.
Any configured source can be passed as-is. The connector never sees `alias`, `metadata` or `type`.

| Field | Use |
|---|---|
| `url` | Base URL. A path prefix is kept, e.g. Mimir's `https://mimir.example/prometheus` |
| `timeoutMs` | Bounds the whole exchange, including reading the response body |
| `auth` | Env var **names** (ADR 0008), resolved through `ConfigService` on **each request**. A missing variable only fails the command that queries |

`grafana` sources are not supported yet. Their `url` is Grafana's URL, not the datasource proxy path.

## Usage

```ts
import { TelemetryModule, TelemetryConnectorFactory } from '@heimdall/telemetry/connectors';

// imports: [TelemetryModule]
const loki = factory.loki(source);
const result = await loki.queryRange({ query: '{service_name="checkout"} |= "timeout"', start, end });
```

## Operations

| Connector | Method | Backend endpoint | Time format sent |
|---|---|---|---|
| `LokiConnector` | `query`, `queryRange` | `GET /loki/api/v1/query`, `/query_range` | unix nanoseconds |
| `PrometheusConnector` | `query`, `queryRange` | `POST /api/v1/query`, `/query_range` (form body) | RFC 3339 |
| `TempoConnector` | `getTrace` | `GET /api/v2/traces/{id}`. A 404 returns `undefined` | – |
| `TempoConnector` | `search` | `GET /api/search?q=<TraceQL>` | unix seconds |

Queries are the backend's own language (ADR 0005) and are passed through untouched. Results are typed and camelCase:
- Nanosecond timestamps stay as strings, so no precision is lost.
- Metric samples are `{ timestampMs, value }`, with `NaN` and `±Infinity` preserved.
- Tempo IDs are normalised to lowercase hex, whether the wire used base64 or hex.

`getTrace` also accepts the v1 `{ batches }` body. If the target Tempo lacks the v2 endpoint, switching to `/api/traces/{id}` only means changing the endpoint.

## Error codes

Every failure is a `TelemetryError` with the `{ errorCode, message? }` shape. Messages name
env vars, never their values, and never include the query string.

| Code | When | CLI exit |
|---|---|---|
| `TELEMETRY_MISSING_CREDENTIALS` | a referenced env var is unset or empty. Checked before any I/O | 4 |
| `TELEMETRY_AUTHENTICATION_FAILED` | HTTP 401 or 403 | 4 |
| `TELEMETRY_RATE_LIMITED` | HTTP 429 | 1 |
| `TELEMETRY_QUERY_REJECTED` | HTTP 400 or 422, or Prometheus `status: "error"`. The message carries the backend's reason | 1 |
| `TELEMETRY_REQUEST_FAILED` | any other non-2xx | 1 |
| `TELEMETRY_TIMEOUT` | `timeoutMs` elapsed | 1 |
| `TELEMETRY_NETWORK_ERROR` | no HTTP response came back (DNS, TLS, socket, caller abort) | 1 |
| `TELEMETRY_INVALID_RESPONSE` | a 2xx status with a body that doesn't match the backend's documented shape | 1 |
