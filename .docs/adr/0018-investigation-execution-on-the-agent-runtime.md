# 0018. Investigation execution on the agent runtime

- **Status:** Proposed
- **Date:** 2026-10-16

## Context

The init phase (ADR 0016) ends with a plan: tiered checks, an origin rule, blind spots. Nothing
runs it yet. [US-001](../user-stories/US-001-on-demand-investigation.md) items 1–3 need it run:
judge what is broken, find where the fault starts and why, and propose mitigations. Since the
metric catalogue landed (ADR 0015, Metrics), every indicator can be compiled into a query from
the graph alone.

The checkout reference manifest documents the walks an execution must reproduce
([`.docs/manifests/checkout/README.md`](../manifests/checkout/README.md)); its fixture scenarios
are the acceptance tests.

## Options considered

- **Code runs the plan, one model call to synthesise.** Deterministic and cheap. It cannot
  follow a lead the plan did not anticipate.
- **The plan, then one follow-up round of model-chosen checks.** More reach, two code paths.
- **An agent loop that starts from the plan.** Chosen. The model chooses each check through
  typed tools, and code keeps what must not depend on the model: how queries are built, what
  leaves the process, which verdicts are objective, and whether the conclusion holds together.

## Decision

The execution phase is an agent run on the runtime of ADR 0017, seeded with the init phase's
output. Code builds every query and judges every objective verdict; the model chooses what to
look at and judges deviations against a baseline.

### Seed and reach

- **Seed:** the system prompt carries the method:
  - the tiers
  - the origin rule (the deepest unhealthy hop of a sync flow, the first unhealthy stage of an
    async one)
  - that no data is never healthy
  - which verdicts the model owns
  - that a conclusion cites result ids
  
  The first message carries the compact plan, the level-0 index, the scope and the blind spots.
- **Reach:** any vertex in scope; a pruned vertex when the call states why. The reason is kept
  in the report. Vertices outside both are refused.

### Tools

All read-only, named by an enum:

| Tool | Does |
|---|---|
| `run_checks` | Runs planned checks by id, optionally over a narrower window (e.g. from the onset) |
| `check_indicator` | Runs any indicator within reach, planned or not |
| `describe_vertex`, `subgraph`, `impact` | Graph lookups (ADR 0015, level 1); no telemetry |
| `search_logs`, `search_traces` | Redacted samples within reach (with logs and traces) |
| `get_trace` | One redacted trace by id, e.g. a `traceId` from a log example |
| `conclude` | The stop tool; validated before the run ends |

### Hybrid verdicts

Every metric check returns statistics computed in code, never a raw series. Who decides the
verdict depends on the expectation:

| Expectation | Decided by | How |
|---|---|---|
| `slo`, `threshold`, `nonZero` | code | `ExpectationEvaluator`: the bound holds or it does not |
| `baseline` | model | `DeviationCalculator` gives robust statistics and a `PreliminarySignal`; the model gives the verdict, citing the numbers |

The statistics are the median and spread of the baseline window, a robust z-score per point,
the peak, the effect size, runs of consecutive deviating points, the onset and the coverage.
The rules, defaults and worked examples are specified in
[`.docs/design/health-evaluation.md`](../design/health-evaluation.md), written with the code in
[story 0018-01](../stories/0018-investigation-execution/01-metrics-investigation.md).

**No data is a verdict of its own.** It is never folded into healthy. When a step with no data
sits deeper than the deepest unhealthy step, the origin is reported as uncertain.

### Queries and redaction

- **Metric queries are compiled from the metric catalogue,** through a template table keyed by
  role and metric type:
  - the metric's labels translate the selector's meanings into label names
  - the metric owner's matchers locate the series
  - the environment's labels are added to every query
  - an indicator's `query:` replaces the template (ADR 0005)
  - the step and rate window follow the window's length
- **Logs and traces** are compiled from each component's telemetry identity:
  - **Logs** use the component's stream selector. Lines are parsed in code, and a step's `match`
    drops the lines that contradict it.
  - **Traces** read the subject's end of the hop: the caller's client or producer spans, or the
    target's server or consumer spans. They are narrowed by the semantic-convention attributes
    that end records.
- **Evidence is a comparison with the baseline,** like the metrics. Logs are grouped into
  templates, and templates that are new or surging are shown with examples. Span operations that
  are new, slower or failing more are shown with an exemplar trace. Samples are time-sliced so a
  capped query does not only describe the end of the window. Logs and traces results are cited as
  evidence and carry no verdict. The rules are in
  [`.docs/design/log-and-trace-evidence.md`](../design/log-and-trace-evidence.md).
- **All telemetry passes through a redacting `TelemetrySource`** before it reaches a tool result
  (ADR 0008):
  - the allowlist is the manifest's field mapping for logs, and a built-in list of semantic
    conventions for spans
  - the scrubbers are the config's `redaction`; `additionalPatterns` are checked at load against
    expensive patterns
  - every redaction is counted, so over-redaction is visible. The names of dropped fields appear
    only in the local report
  
  The rules are specified in
  [`.docs/design/redaction-and-scrubbers.md`](../design/redaction-and-scrubbers.md), written with
  [story 0018-02](../stories/0018-investigation-execution/02-logs-and-traces-evidence.md). This closes
  ADR 0008's amendment: the raw connectors stop being reachable from the engine.

### Conclusion and outcomes

`conclude` carries:
- an outcome (`cause-found`, `no-signal`, `inconclusive`)
- the cause vertex and mechanism
- the origin step
- a verdict per check run
- the cited result ids
- the mitigations, which come in three tiers (immediate or manual, short-term, prevention),
  each with its trade-offs

A `ConclusionValidator` rejects a conclusion whose cause is not in the graph, that cites results
that do not exist, that overrides an objective verdict, or that finds a cause without
mitigations. A rejection goes back to the model once; a second invalid conclusion fails with
`INVESTIGATION_CONCLUSION_INVALID`.

| Outcome | Exit (ADR 0006) |
|---|---|
| `cause-found` | 0 |
| `no-signal`, `inconclusive` | 3 |
| budget spent (`AGENT_BUDGET_EXCEEDED`) | 5 |

`investigate` runs execution unless `--plan-only` is given. New events are emitted alongside
those of ADR 0016: `investigation.check_completed`, `investigation.agent_turn` and
`investigation.concluded`. The report and the trace carry the run's trace id. Budgets come from
`INVESTIGATION_*` variables, overriding the agent defaults of ADR 0017 for investigation runs.

## Consequences

**Easy:**
- Queries, redaction and objective verdicts are pure code, tested against the fixtures without
  a model.
- The walks in the checkout README become end-to-end tests with a scripted model.
- The model sees statistics instead of raw series, which is cheaper and keeps the numbers it
  reasons over identical to the ones code checked.

**Hard:**
- **Runs are not deterministic.** The same report can be reached by different walks, or not
  reached. This is mitigated by the validator, the budgets, the traces, scripted-model tests,
  and replay with golden evaluation (ADR 0007).
- **The baseline verdict depends on the model reading statistics well.** The preliminary signal
  and the documented thresholds keep its judgement anchored, and golden runs measure it.
- **Over-redaction degrades conclusions quietly** (ADR 0008). The redaction counters make it
  visible; they do not prevent it.

**Will regret if:** models routinely ignore the plan and wander within the budget. Then the plan
should become binding for the confirm and localise tiers, with the loop reserved for explain and
corroborate.
