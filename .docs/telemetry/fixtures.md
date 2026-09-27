# Fixture datasources

Swap any telemetry backend for deterministic, synthetic data generated from a **scenario**.
The connectors and their callers do not change (ADR 0014).

> Fixture mode is announced on stderr at every CLI start, even under `--quiet`. Results
> are synthetic: never reason about a real incident from them.

## Switching

| Variable | Values | Default |
|---|---|---|
| `PROMETHEUS_DATASOURCE_TYPE` | `http`, `fixture` | `http` |
| `LOKI_DATASOURCE_TYPE` | `http`, `fixture` | `http` |
| `TEMPO_DATASOURCE_TYPE` | `http`, `fixture` | `http` |
| `TELEMETRY_FIXTURE_SCENARIO` | a directory under `libs/telemetry/scenarios` | required once any backend is `fixture` |
| `TELEMETRY_FIXTURE_ANCHOR` | ISO-8601 timestamp: the end of the scenario timeline | process start, truncated to the minute |

```bash
PROMETHEUS_DATASOURCE_TYPE=fixture LOKI_DATASOURCE_TYPE=fixture TEMPO_DATASOURCE_TYPE=fixture \
TELEMETRY_FIXTURE_SCENARIO=increased-latency-1 heimdall …
```

A fixture ignores the source's URL and credentials: no env var for auth is needed and
nothing reaches the network. Pin `TELEMETRY_FIXTURE_ANCHOR` for byte-identical results
across runs: same scenario files, same anchor and same request give the same response.

Mixing fixture and live backends works, but fixture log lines then carry trace IDs a live
Tempo does not have; the CLI warns about it.

## Shipped scenarios

| Scenario | Timeline | What happens |
|---|---|---|
| `healthy-baseline` | 2h | No incident: diurnal seasonality and noise only. The control case |
| `increased-latency-1` | 2h | A batch job's long transaction locks `orders` at T−34m; checkout's DB pool saturates and p99 climbs from 180ms to 2.4s from T−30m; 504s from T−28m |
| `error-burst-30s` | 30s | The payment provider returns 502s for ~20s; payments' error ratio spikes to ~45% |
| `memory-leak-2d` | 2d | catalog v2.14.0 leaks heap through an unbounded cache; OOMKilled every ~6h; GC, latency and errors rise with the heap |

Each `scenario.yaml` has a `description` stating the root cause. It is for people only
and never appears in generated data.

## Behaving like the real backends

| | Prometheus | Loki | Tempo |
|---|---|---|---|
| Endpoints | `/api/v1/query`, `/query_range` | `/loki/api/v1/query`, `/query_range` | `/api/v2/traces/{id}`, `/api/search` |
| "Now" | the anchor | the anchor | the anchor |
| Limits | 11,000 points per series | `limit` 100 by default, 5,000 max; log queries cannot be instant | `limit` 20, `spss` 3; searches up to 168h |
| Errors | `400 {status:"error", errorType:"bad_data"}` | `400` plain text | `400` plain text; unknown trace `404` |

There is never data after the anchor. Before the timeline starts, curves hold their
baseline, so "the last 6h" of a 2h scenario is still realistic.

## How a query finds its data

The fixture cannot evaluate PromQL, LogQL or TraceQL. It routes:

1. **Metric series** (Prometheus, and metric LogQL): the **first** `match` regex that
   tests true against the query wins, together with every series sharing that exact
   pattern. Put specific patterns (ratios `a / b`) before general ones (`a`).
2. **Log streams and trace templates**: **every** stream or template whose `match` tests
   true (no `match` means "any query").
3. **Label matchers** in the query (`service="checkout"`, `code=~"5.."`, `!=`, `!~`)
   narrow metric series and log streams by their `labels`. A matcher on a label the
   candidate does not have is ignored, since the query may aggregate it away.
4. **Loki line filters** (`|=`, `!=`, `|~`, `!~`, including a leading `(?i)`) run on
   the generated lines. Parsers and label filters after them (`| json | status="500"`)
   are not evaluated.
5. **TraceQL conditions** are ANDed: `name`, `status`, `kind`, `duration`,
   `resource.service.name` / `.service.name`, `span.<attr>` / `.<attr>` must all hold on
   one span; `traceDuration`, `rootName`, `rootServiceName` on the trace. `||`,
   structural operators and aggregates are ignored.

A query that nothing matches gets an empty success, as a backend with no data would
answer. That can hide a gap in a scenario: when an agent's query comes back empty,
check the patterns.

## Writing a scenario

A directory under `libs/telemetry/scenarios/`, named `^[a-z0-9][a-z0-9-]*$`:

| File | Required | Holds |
|---|---|---|
| `scenario.yaml` | yes | `version: 1`, `duration`, `resolution` (noise bucket, default `15s`), optional `seed`, `description` |
| `metrics.yaml` | no | `series`: Prometheus query results |
| `logs.yaml` | no | `streams` (log queries) and `series` (metric LogQL) |
| `traces.yaml` | no | `traces`: trace templates |

A missing signal file means no data for that signal. Everything is validated at startup
and every problem is reported at once, with its file and field path
(`TELEMETRY_FIXTURE_SCENARIO_INVALID`). YAML anchors and merge keys (`<<: *base`) work
within a file. The `shipped scenarios` spec loads every directory, so a broken scenario
fails `npm test`.

### Curves

Every number that changes over time is a curve, evaluated at scenario-relative time
(`0` is the start of the timeline):

```yaml
curve:
  baseline: 0.18                  # or `ref: <metric series id>` + `scale` / `offset`
  phases:                         # in time order; each starts from the level reached so far
    - { shape: ramp, at: 90m, to: 2.4, over: 10m }   # `over: 0s` is a step
    - { shape: spike, at: 100m, to: 5, decay: 2m }   # back to the pre-spike level
    - { shape: sawtooth, at: 3h, to: 3.4e9, period: 6h }
    - { shape: hold, at: 40h }                       # freeze, e.g. to end a sawtooth
  seasonality: { period: 24h, amplitude: 0.1, peakAt: 14h }   # ×(1 ± 10%)
  noise: { stddev: 0.012 }        # absolute, same unit as the curve
  clamp: { min: 0, max: 50 }
  round: true                     # counts: connections, locks, pods
```

`ref` is how signals stay consistent: a log stream's rate, a placeholder in a log line, or
a trace's duration can follow a metric series. With `offset` and a clamp, a ref can
become a threshold, e.g. errors only when the heap is above 2.6GB. Refs may only point
at `metrics.yaml` series. Cycles are rejected.

Durations: `500ms`, `30s`, `5m`, `1h30m`, `2d`, `1w`.

### Metric series (`metrics.yaml`, and `series` in `logs.yaml`)

```yaml
series:
  - id: checkout_http_p99_seconds
    match: 'histogram_quantile\(\s*0?\.99\s*,[\s\S]*http_server_request_duration_seconds'
    labels: { service: checkout, namespace: shop }
    curve: { … }
```

A series is the **result** of a query, e.g. the p99 curve, not the raw histogram. In
`logs.yaml`, `scaleByRange: true` makes a per-second curve answer counts:
`count_over_time(…[5m])` returns 300 times the curve, rounded.

### Log streams (`logs.yaml`)

```yaml
streams:
  - id: checkout_error
    labels: { service_name: checkout, namespace: shop, level: error }
    rate: { ref: checkout_http_error_ratio, scale: 110 }   # lines per second
    templates:
      - line: 'level=error msg="acquire connection timeout" waited_ms={int:5000-5004} trace_id={traceId:checkout_post:error}'
        weight: { baseline: 0, phases: [{ shape: ramp, at: 90m, to: 8, over: 5m }] }
```

Placeholders:

| Placeholder | Renders |
|---|---|
| `{uuid}` | a v4 UUID |
| `{hex:16}` | 16 hex digits |
| `{int:100-900}` | an integer in the range |
| `{pick:GET\|POST}` | one of the options |
| `{ref:series}` | the metric series' value at the line's time |
| `{ref:series*1000}` | the same, scaled and rounded (seconds → ms) |
| `{traceId:template}` | the ID of a trace of that template that started at or before the line |
| `{traceId:template:error}` | the same, error traces only |
| `\{id}` | a literal `{id}`, e.g. a route template |

JSON (`{"level":"info"}`) and Go-template braces (`{{.x}}`) stay literal. Lines are
generated a second at a time, so line counts follow `rate` and weights shift as the
incident develops.

Include secret-shaped strings where production logs would have them. The shipped
scenarios use AWS's documented example key, jwt.io's example token and fake passwords,
so the ADR 0008 scrubbers have something to catch.

### Trace templates (`traces.yaml`)

```yaml
traces:
  - id: checkout_post
    rate: { ref: checkout_http_rps_200, scale: 0.05 }       # sampled traces per second
    duration: { ref: checkout_http_p50_seconds, scale: 1000 } # median root ms, log-normal spread
    errorDuration: { baseline: 5010 }                        # optional: e.g. a timeout
    jitter: 0.45
    error: { ref: checkout_http_error_ratio }               # probability 0–1
    root:
      service: checkout
      name: POST /api/checkout
      kind: server                                           # server, client, internal, producer, consumer
      attributes: { http.response.status_code: 200 }
      errorAttributes: { http.response.status_code: 504 }   # merged in on the error path
      children:                                              # run one after another
        - service: checkout
          name: UPDATE orders
          kind: client
          share: { baseline: 0.18, phases: [{ shape: ramp, at: 88m, to: 0.93, over: 6m }] }
          errorSource: true                                  # where error traces fail
          errorMessage: 'pool exhausted'
```

`share` is a fraction of the parent's duration. If siblings add up to more than 95%,
they are scaled down to fit. An error trace fails at one of its `errorSource` spans
(the root when none is marked): that span gets the error status, `errorAttributes` and an
`exception` event, and its ancestors get the error status.

Trace IDs are derived, not stored: they encode template, second and ordinal, are
scrambled so they look random, and are checked on lookup. An ID from a different or
edited scenario is simply not found.

## Error codes

| Code | When | CLI exit |
|---|---|---|
| `TELEMETRY_INVALID_DATASOURCE_CONFIG` | unknown `*_DATASOURCE_TYPE`, malformed anchor, or a fixture without `TELEMETRY_FIXTURE_SCENARIO` | 2 |
| `TELEMETRY_FIXTURE_SCENARIO_NOT_FOUND` | no such scenario directory (the message lists the available ones) | 2 |
| `TELEMETRY_FIXTURE_SCENARIO_INVALID` | YAML, schema, regex, placeholder or `ref` problems, each with file and field path | 2 |

Rejections the real backend would issue (too many points, bad parameters) surface as
the usual `TELEMETRY_QUERY_REJECTED`.

## Limits of the imitation

- Generation is synchronous, so a caller's abort cannot interrupt it. Instead, one Loki
  query generates at most 500,000 lines and one Tempo search at most 200,000 traces;
  past that, the result is partial.
- Queries longer than 16,384 characters are rejected before any regex sees them.
- Metric series are evaluated at the query's steps, not aggregated: `rate()` windows,
  `offset` and subqueries do not change the values.
