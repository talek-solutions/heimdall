# 0016. Investigation init phase: model-classified entry, deterministic scope and plan

- **Status:** Proposed
- **Date:** 2026-09-27

## Context

[US-001](../user-stories/US-001-on-demand-investigation.md): an engineer types
`heimdall investigate "checkouts are not working" --env prod`. Before any telemetry is read,
Heimdall has to answer three questions:

1. **What is meant?** "Checkouts" names nothing in the manifest. The `shop` reference system
   calls the capability `ordering`, and a user's words rarely match a manifest's names.
2. **What could cause it?** From the thing that is meant, which components, dependencies and
   members can make it fail, and which can be ruled out without looking.
3. **What to look at, in which order?** A fixed, explainable sequence of checks: something the
   engineer can read before it runs and a test can assert without a model.

ADR 0015 made traversal Heimdall's job and proposed an exact → lexical → vector cascade for
`locate()`. It left open how a free-text symptom, rather than an alert label, finds its entry.

## Options considered

- **Aliases in the manifest, lexical match, model only on a miss.** Cheapest per query and
  deterministic when it hits. Needs a schema change, and every manifest has to anticipate its
  users' vocabulary; a missing alias is a silent miss.
- **Model classification first.** One structured call per free-text query over the compact
  index. No schema change, and it handles vocabulary nobody anticipated. Costs a call, and
  locate is no longer deterministic.
- **Model for everything** (entry, scope and plan). The least code. Nothing is testable
  without a model, the plan cannot be explained, and every run pays for reasoning that is
  mechanical.

## Decision

**The model classifies; code scopes and plans.** Five stages, of which only one calls a model:

| Stage | Who | Output |
|---|---|---|
| Intake | code | query, environment (`System.environments[]` → config context), window |
| Classify | model | symptom roles + ranked entry candidates |
| Scope | code | suspect and impact-only flows, in-scope vertices, pruned vertices with reasons |
| Plan | code | tiered, ordered checks; blind spots |
| Emit | code | typed events and one `InvestigationPlan` |

### Intake

The window ends at "now" and spans `--since` (default 60 minutes). It is compared with the
preceding window of the same length, which fixtures can always serve; a day-ago baseline
cannot be. In fixture mode "now" is the fixture anchor, as ADR 0014 requires. The environment
is `--env`, or the system's only environment.

### Classify: one forced tool call

The model sees the level-0 index (one line per functionality, flow, component and member, each
prefixed with its vertex id) and the query, and is instructed to answer through one strict
tool whose schema constrains `vertexId` to the locatable ids and roles to `IndicatorRole`.
`tool_choice` stays `auto`: forcing a named tool conflicts with thinking, which is on by default
on the default model (`claude-opus-5`, ADR 0004), and newer models reject it outright. An answer
without the tool call, or with ids or values the graph does not know, is invalid; code retries
once. Exact name matches in the query are passed as hints, not used as a short-circuit.

- **Ambiguity** is a top candidate under a minimum confidence, or a runner-up within a margin
  of it. A terminal asks the engineer to choose; without one, the command exits 2 naming
  `--entry`.
- **`--entry <vertex>`** skips the model entirely: scripting, tests, and ambiguity. The
  symptom is then unclassified and no check is filtered by role.
- **Only the query and the index** are sent, never telemetry, so ADR 0008 is not engaged.

### Scope: which parts of the system could cause this?

Starting at the entry, keep what can break it. Every rule reads a manifest field:

- **Sync flows are suspects; async flows are impact only.** An async flow starts after the
  user's request has already succeeded. When the symptom is lag, async flows are suspects too.
- **Operations route to members.** A step's `match.operation`, or its dependency's operations,
  classify it as a read or a write; `writeTo` and `readFrom` then keep only the members that
  serve it. A step that writes to a primary drops the replicas.
- **Soft dependencies are never dropped.** They are kept and ordered after hard ones. A soft
  failure degrades rather than breaks, but it can still cause the symptom: a failing cache
  sends every read to the database.
- **Neighbours within a hop budget.** Components on the path keep their other dependencies,
  and shared targets keep their other callers: contention is a common cause. A batch job
  holding locks on the database checkout writes to is the cause in the `increased-latency-1`
  scenario.
- **Everything else is dropped with a reason**: unreachable from the entry, beyond the hop
  budget, or not routed. The reasons are shown to the engineer, and they are where to look
  next if nothing in scope turns out to be broken.

### Plan: in what order do we look, and at what?

| Tier | Purpose | Checks |
|---|---|---|
| confirm | Is it broken, and since when? The onset sets the window for the rest | Functionality KPIs and suspect flows' indicators; never filtered |
| localise | Where does the fault start? | Each suspect flow's steps, in order (see below for which unhealthy step is the origin) |
| explain | Why that step? Runs only for the origin step | The target component, its routed members and the caller's saturation, then other dependencies (hard, then soft), then other callers of the target |
| corroborate | Evidence for the explanation. Runs only for the origin step | Error logs of the caller and target; traces when the flow propagates trace context, otherwise logs joined on `correlationKey`; logs of other callers of the target, which may have no indicators at all |
| impact | What else is hurt; reported, not treated as a cause | Impact-only flows' indicators |

- **Which unhealthy step is the origin depends on the flow's mode.** In a sync flow the hops are
  nested inside one request: a failing hop also fails every hop that wraps it, so the *deepest*
  unhealthy hop is where the fault starts. In `error-burst-30s` the provider's 502s at step 5
  also fail step 4 (`/charges`) and step 1 (`/api/checkout`). In an async flow the stages run one
  after another: a stalled stage starves the next, so the *first* unhealthy one is the origin.
  The plan conditions explain and corroborate on each step; the execution phase applies this
  rule to decide which of them run.
- **Symptom roles filter** localise to the symptom's roles and explain to those roles plus
  saturation and lag, since causes show up differently from symptoms.
- **Blind spots** are in-scope vertices with no indicator or no telemetry. They say where
  Heimdall cannot see, so a clean plan is not mistaken for a healthy system.
- **An entry that is a component, dependency or member** has no flow to walk. Its own
  indicators confirm, its dependencies localise, and flows it serves are impact.

### Emit

The engine emits typed events (`investigation.started`, `symptom_classified`,
`entry_located`, `scope_resolved`, `plan_ready`) and never prints (ADR 0006). The CLI renders
them: `--ndjson` streams them, `--json` prints the final plan, and text shows a tree. The plan
format is in [`.docs/schema/investigation-plan.md`](../schema/investigation-plan.md).

Execution does not exist yet. `investigate` stops after the plan and says so on stderr;
`--plan-only` is accepted from the start so the command's options do not change when
execution lands.

## Consequences

**Easy:** scope and plan are pure functions of the graph, the entry and the symptom roles, so
they are tested against reference manifests with no model. The engineer sees what will be
checked, why, and what was ruled out before any query runs. One model call per investigation
start is cheap next to the execution loop.

**Hard:**

- **Locate is not deterministic.** The same query can land on different entries across
  runs or models. Mitigated by `--entry`, by replaying the classification call (ADR 0007),
  and by golden evals of locate accuracy on recorded queries.
- **Deviation from ADR 0015's cascade.** Exact and lexical matching do not short-circuit
  free-text queries. Alert-driven investigations (US-002) should still locate by exact label
  match with no model call, because an alert names its series.
- **Neighbour and contention scope grows with fan-in.** A shared database with many callers
  pulls them all in. The hop budget bounds it; a check cap bounds the plan.

**Will regret if:** the model's classification quality is poor on real vocabularies and
aliases turn out to be needed anyway. Then the aliases option comes back as a tier before the
model, not instead of it.
