# 0015. System manifest as a traversable graph

- **Status:** Proposed
- **Date:** 2026-09-27

## Context

Heimdall can fetch logs, metrics and traces (0009), but it does not know what it is looking
at: which services exist, what they call and over which transport, which flows the business
depends on, and which metrics mean "healthy". Without that, either someone writes every
query per deployment, or the model guesses from raw telemetry. Neither scales past one
system.

Users already hold this knowledge, usually as an architecture diagram. A diagram carries no
semantics a program can use: shapes and colours do not say which arrow is a hard
dependency, which replica serves reads, or which metric measures which step of a flow.

Two further constraints:

- **Context has to reach the model cheaply.** A complete manifest of a small system (six
  components, three flows) is close to 10k characters, roughly 3k tokens; at 200
  components it is on the order of 100k tokens, re-sent on every step of the agent loop. Most of it — matchers, label
  mappings, instance addresses — is input to building queries, not to reasoning.
- **Investigations have a shape.** From a symptom, walk down to what could cause it; from a
  suspect, walk up to what it affects. That is a graph walk, and a graph walk is
  deterministic work that does not need a model.

## Options considered

- **Prose or diagram documentation handed to the model** — cheapest to write. Nothing is
  checkable, nothing can be traversed, and the model rereads all of it on every step.
- **A structured manifest placed in the prompt as-is** — checkable, but cost grows linearly
  with the system while relevance does not; the model searches for the few percent that
  matter to this incident.
- **Embeddings first: vectorise the architecture and retrieve** — good at matching a
  free-text symptom to a component. Loses exactly what root-cause analysis needs: edge
  direction, hard versus soft, hop distance, thresholds.
- **A typed manifest compiled into a graph that Heimdall walks, with the model seeing a
  projection** — the most to build: a compiler, a traversal layer, a model view and its
  tools.

## Decision

A typed manifest, compiled into a property graph. **Heimdall finds the entry point and
walks the graph; the model receives only the slice relevant to the issue.**

### Authoring

Kubernetes-style YAML documents (`apiVersion / kind / metadata / spec`), splittable across
files and repositories, merged by `metadata.name` within a `system`:

- `System` — environments, each bound to a context of the user-level config (0013) and the
  labels it adds to every selector.
- `Component` — type (frontend, service, broker, cache, datastore, vendor, worker),
  telemetry identity per signal, metric catalogue, `dependsOn`, `topology` members,
  `dataModel`, component-level indicators.
- `Functionality` — a business capability, realised by flows, carrying KPIs.
- `Flow` — ordered steps over named dependencies, each with a `match` narrowing metrics to
  that step.

A dependency is declared on the caller, is named, and carries transport, mode (sync or
async), criticality (hard or soft), operations, read/write routing and relevant
configuration. Functionalities, flows and extra indicators are optional: components alone
still work, at component granularity.

### Graph

Vertices: functionality, flow, step, dependency, component, topology member. Edges:
`REALIZED_BY`, `HAS_STEP`, `NEXT`, `OVER`, `CALLS`, `TARGETS`, `MEMBER_OF`,
`REPLICATES_TO`. Edge direction always means "depends on"; the direction data travels is a
property.

Dependencies are reified as vertices. Steps and indicators must reference one specific
dependency — a REST and a WebSocket dependency between the same two components must stay
distinct — and an edge cannot be the target of another edge.

### Metrics

A **metric definition** lives on the emitting component: type, unit, what it measures
(inbound traffic over one transport, or a named outbound dependency) and what each label
means.

An **indicator** is a metric plus selector, role and expectation, attached to a
functionality, flow, step, component or member. Roles: throughput, errors, latency,
saturation, lag, kpi. Expectations: baseline (the default), slo, threshold, nonZero.

Step and component indicators are **derived** from definitions whose labels cover the
step's `match`. Users declare only what cannot be inferred — KPIs, end-to-end timings,
thresholds. Derived indicators carry `provenance: derived`.

### Traversal is Heimdall's job

- `locate(query)` — exact identifier match (names, telemetry labels from an alert), then
  lexical, then vector search (deferred), behind one port.
- `subgraph(vertex, hops)` — the neighbourhood of a vertex.
- `impact(vertex)` — walk incoming edges up to flows and functionalities.
- `path(functionality | flow)` — ordered steps, so the first failing step localises the
  fault.

### The model receives only what is relevant

- **Level 0, always in the prompt** — a compact index: one line per functionality, flow
  and component, adjacency with mode and criticality. During an incident, only the subgraph
  around the located entry point.
- **Level 1, on request** — `describe`, `indicators`, `subgraph`, `impact`.
- **Level 2, never in the prompt** — `check(indicator, window)` compiles the indicator into
  the backend's query from matchers and label semantics, runs it, and returns redacted,
  typed results. The model does not see matchers or write queries for declared indicators.

### Storage

Normalised: one row per resource plus derived tables — vertices, dependencies, edges, flow
steps, metric definitions, indicators. Each resource carries a content hash of its
canonical form, used for versioning, caching and re-derivation.

A worked system — manifest, graph, model view and two walks — is in
[`.docs/manifests/shop`](../manifests/shop/README.md).

## Consequences

**Easy:** the model starts every investigation already knowing the shape of the system, at
roughly a tenth of the manifest's size (about 1k characters against 10k for the shop
example). Finding the entry point, walking
dependencies and computing blast radius — from a lagging replica up to a business
capability — is code, testable without a model. Coverage gaps become lintable in CI against
the manifest alone: a dependency on no flow, a step with no indicator, a component with no
telemetry identity.

**Hard:**

- **Tension with 0005.** Indicators compile to backend queries through a fixed set of
  templates (role × metric type) with a native `query:` override per indicator. That is
  close to the hybrid 0005 rejected, and 0005's warning applies: the override can become
  the default path. The difference is that the templates cover a closed set — about six
  roles over three metric types — not a query language. If the template set starts growing
  filters, joins or per-backend branches, or overrides become the majority, stop and
  revisit.
- **The field mapping moves.** 0005's per-query field map becomes per log stream
  (`telemetry.logs.fields`) and per metric definition (`labels`). `FieldSemantic` gains
  label semantics (route, method, operation, table, topic, consumerGroup, outcome) so the
  mapping remains the egress allowlist of 0008.
- **Authoring cost.** A useful manifest takes real effort. The mitigation is
  discovery-assisted drafts — edges from Tempo's service graph, metric names from
  Prometheus, labels from Loki — for the user to correct; the schema carries
  `provenance: declared | discovered` from the start.
- **More tool round-trips.** The model fetches detail rather than reading it. Mitigated by
  including level-1 detail for the alerting component in the first prompt.

**Measured, not assumed:** what level 0 contains is decided by the golden evals of 0007 —
the same recorded incidents run with the full manifest, level 0 only, and level 0 plus
automatic level 1, compared on root-cause accuracy and tokens.

**Open:**

- **Store.** Postgres with recursive queries is sufficient at tens to hundreds of
  components; a graph database only if walks outgrow it. Heimdall is file-based today, and
  where the compiled graph lives before there is a server is undecided.
- **Dependency references** are `component/name`; `name` is optional and `from/to` is
  accepted when unique.
- **Vectors** stay behind `locate()` until the index no longer fits the prompt or free-text
  symptom search becomes a real use case. Embedding past incidents is the likelier first
  use.

**Will regret if:** manifests go stale. A manifest that disagrees with reality is worse
than none, because the model trusts it. Drift detection — declared dependencies against the
service graph Tempo observes — should follow soon after the first release.
