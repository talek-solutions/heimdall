# 0005. Telemetry config carries native queries

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

Users describe what to fetch via declarative YAML — no user code is executed (that choice
avoids a runtime trust boundary, sandboxing, timeouts, and broken bundling). The open
question was what a "query" in that YAML actually contains.

## Options considered

- **Abstract query model** — a portable vocabulary (service, severity, window, filters)
  compiled per backend. Configs move between backends. But LogQL, PromQL, and Datadog's
  syntax share no semantic model, so the DSL grows teeth: filter, then aggregation, then
  joins, then half a query planner that is still weaker than every native language.
- **Native query strings + typed field mapping** — the config carries the backend's own
  query plus a mapping describing what the returned fields *mean*. No language to own.
- **Hybrid with a `raw:` escape hatch** — in practice the escape hatch becomes the default
  path and both mechanisms need maintaining.

## Decision

Native query strings plus a typed field mapping (`FieldSemantic`: service, severity,
trace id, message, …).

## Consequences

**Easy:** full expressive power of each backend from day one; no query planner to write;
adding a backend is an adapter plus a response mapper.

**Hard:** a config is backend-specific and does not port. Acceptable for an internal tool
against a known stack (0009).

**Important:** the field mapping is not decoration. It is how the model learns what the
data *means* — fetching logs is the easy half, and a raw text blob produces markedly worse
RCA than typed, semantically-labelled fields. The mapping is also what the egress
allowlist keys off (0008), so it is load-bearing twice over.
