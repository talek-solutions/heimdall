# 0014. Fixture datasources behind the connectors' fetch

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

The Loki, Prometheus and Tempo connectors only talk to live backends, so no two runs see
the same data. That rules out reproducible development, CI runs against realistic data,
and the golden evals in 0007, which need the same incident every time. Recording a
production incident is not a substitute: the data is unredacted (0008), tied to one
moment, and does not exist for incidents we want to rehearse but have not had.

What is needed is a switch, per backend, between the real datasource and a synthetic
one, whose data is realistic, correlated across metrics, logs and traces, and identical
from run to run. Callers must not change.

## Options considered

- **Seed real backends:** generate data, backfill Prometheus TSDB blocks, push to Loki
  and Tempo, run them in Docker. Queries are evaluated for real and only the URL changes.
  But CI needs Docker, runs are slow, and "the same data" depends on backfill mechanics.
- **Pre-generated response files:** recorded or generated JSON per query. Easy to diff,
  but resolution is fixed: a 2d window at 15s is 11,520 points per series, and every other
  step or window needs resampling. Relative windows ("the last hour") never line up.
- **A fixture implementation per connector:** an `IPrometheusConnector` with HTTP and
  fixture implementations. Clean types, but it skips the wire mappers and error mapping,
  so fixture output is never checked by the code that checks production output, and the
  public connector types change.
- **A fixture `fetch` behind the existing client:** `TelemetryHttpClient` already takes a
  `fetchFn`. A fixture backend answers in each backend's own wire format, generated on
  demand from a scenario. Everything above the fetch runs for real. The cost: the fixture
  cannot evaluate PromQL, LogQL or TraceQL, so it has to route queries to data instead.

## Decision

A fixture `fetch` behind the existing client, fed by generative YAML scenarios.

- **Selection:** `PROMETHEUS_DATASOURCE_TYPE`, `LOKI_DATASOURCE_TYPE` and
  `TEMPO_DATASOURCE_TYPE` are `http` (the default) or `fixture`. `TELEMETRY_FIXTURE_SCENARIO`
  names the scenario and `TELEMETRY_FIXTURE_ANCHOR` optionally pins the end of its
  timeline. They are resolved once, by a custom provider, at bootstrap; the scenario is
  loaded and validated then too, so a bad setup fails before any command runs.
- **The swap:** `TelemetryConnectorFactory` builds the same connectors either way. In
  fixture mode their client gets a fixture `fetch`, a `http://<backend>.fixture.invalid`
  base URL (which cannot resolve) and no auth, so no credentials are needed.
- **Scenarios** (`libs/telemetry/scenarios/<name>/`): curves (baseline, ramp, spike,
  sawtooth, hold, seasonality, noise, clamp, `ref` to another series) evaluated on demand
  for any window or step. Noise is keyed on scenario-relative time, so the same scenario,
  anchor and request always produce the same bytes.
- **Routing, not evaluation:** for metric results, the first `match` regex that fits a
  query wins; log streams and trace templates answer whenever theirs fits. Label
  matchers written in the query narrow both. Loki line filters run on the generated
  lines, and simple TraceQL conditions on the generated spans.
- **Correlation:** logs and traces can take any curve from a metric series (`ref`), and a
  log line's `{traceId:…}` is a trace the Tempo fixture serves. Trace IDs are derived and
  checked, not stored.
- **Faithful edges:** no data after the anchor; backend limits and defaults are imitated
  (Prometheus's 11,000 points per series, Loki's and Tempo's limits); rejections use the
  backend's own error bodies, so the real client maps them to the usual codes.

## Consequences

**Easy:** any incident can be rehearsed against the real connector code, deterministically,
in CI, with no network and no secrets. Adding a scenario is a directory of YAML.

**Hard:** routing is only as good as the scenario's regexes, and they are written
against queries the agent has not yet been observed to make. A query that no pattern fits
gets an empty result, which is realistic but can hide a scenario gap. Expect to widen
patterns as real agent queries are seen.

**Relation to 0007:** fixtures sit *below* redaction; replay (`ReplayTelemetrySource`)
sits above it. They complement each other: fixtures exercise connectors, mappers and the
future redaction layer; replay pins a whole recorded run.

**Relation to 0008:** the risk runs the other way: not a leak, but a confident RCA built on
synthetic data during a real incident. Fixture mode is therefore announced on stderr by
the CLI at every start, even under `--quiet` (printed by the CLI, never the lib, per 0006),
with a second warning when fixture and live backends are mixed. Log templates carry
secret-shaped strings (documented example keys, fake connection strings) so the scrubbers
have something to catch. A scenario's `description` is never emitted in any data.

**Deferred, and binding when the engine lands:** there is no injectable clock yet. Any code
that turns "the last hour" into timestamps must take "now" from the fixture anchor in
fixture mode, or a pinned anchor will not line up with relative windows.
