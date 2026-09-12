# 0009. Grafana stack as the first backend

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

The telemetry port needs a first real implementation to prove its shape. Choosing the
wrong first adapter produces a port contorted around one vendor's quirks.

## Decision

Grafana stack first: Loki (logs), Prometheus/Mimir (metrics), Tempo (traces).

## Consequences

**Easy:** three distinct signal types across one credential and one deployment model
exercises the port properly — a logs-only first adapter would have produced a
logs-shaped port. Open HTTP APIs are straightforward to record as fixtures for replay
(0007). No vendor rate limits or per-query billing to design around while the shape is
still moving.

**Deferred:** Datadog, Elastic/OpenSearch, and Kubernetes plus deploy history
(GitHub/Argo) are the obvious next adapters behind the same port.

**Worth noting:** deploy history is not telemetry, but "what shipped immediately before
this started" is frequently the highest-value single input to a root-cause analysis. It
being absent from the first milestone is a known gap in answer quality, not an oversight.
