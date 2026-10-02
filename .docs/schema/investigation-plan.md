# `heimdall investigate`: the investigation plan

The init phase of [ADR 0016](../adr/0016-investigation-init-phase.md) for
[US-001](../user-stories/US-001-on-demand-investigation.md): from an engineer's words to an ordered
plan of checks. Implemented in `libs/investigation` (`@heimdall/investigation`) on top of the graph
in `@heimdall/core/graph`.

```bash
heimdall investigate "checkouts are not working" --env prod
```

## Options

| Option | Meaning |
|---|---|
| `<query...>` | The issue in the engineer's words. Unquoted words are joined |
| `--env <name>` | An environment of the manifest's `System`; optional when it has exactly one |
| `--since <duration>` | How far back to look: `45s`, `30m`, `2h`, `1d`. Default `INVESTIGATION_LOOKBACK`, else `60m` |
| `--entry <vertex>` | Start here, e.g. `functionality:checkout`; the model is not called and the symptom is unclassified |
| `--plan-only` | Stop after the plan. Running checks does not exist yet, so today this only silences the notice saying so |
| `--json` | The plan as one JSON object on stdout |
| `--ndjson` | Each stage as one JSON event per line on stdout |
| `--quiet` | No progress on stderr |

The manifest is read from `HEIMDALL_MANIFEST`, else `~/.heimdall/manifest.yaml`
([heimdall-manifest.md](heimdall-manifest.md)).

| Variable | Default | Meaning |
|---|---|---|
| `INVESTIGATION_TRIAGE_MODEL` | `claude-opus-5` | Model for the classification call |
| `INVESTIGATION_LOOKBACK` | `60m` | Window when `--since` is not given |
| `INVESTIGATION_HOP_BUDGET` | `1` | Hops beyond the path that neighbours and contention may reach; `0` disables both |
| `INVESTIGATION_MAX_CHECKS` | `40` | Cap on checks; the plan reports how many it dropped |

In fixture mode the window ends at the fixture anchor (ADR 0014).

## Output

Text prints progress on stderr and the plan as a tree on stdout. `--json` prints one
`IInvestigationPlan`; `--ndjson` prints the events below as they happen, the last one carrying
the plan. Times are ISO-8601 strings.

```jsonc
{
  "query": "checkouts are not working",
  "system": "storefront",
  "environment": { "name": "prod", "context": "prod" },        // absent when the system has none
  "window": {
    "start": "2026-09-27T11:00:00.000Z", "end": "2026-09-27T12:00:00.000Z",
    "baseline": { "start": "2026-09-27T10:00:00.000Z", "end": "2026-09-27T11:00:00.000Z" }
  },
  "symptom": { "roles": ["errors", "throughput"], "method": "model" },   // model | unclassified
  "entry": {
    "vertex": "functionality:checkout", "type": "functionality",
    "method": "model",                                   // model | flag | prompt
    "confidence": 0.92, "reason": "…",
    "candidates": [{ "vertex": "functionality:checkout", "confidence": 0.92, "reason": "…" }]
  },
  "scope": {
    "suspectFlows": ["flow:place-order"],
    "impactFlows": [],
    "vertices": [{ "vertex": "component:orders-reconcile", "reason": "contention" }],
    "pruned": [{ "vertex": "member:mysql-main/replica-1", "reason": "not-routed" }]
  },
  "checks": [
    {
      "id": "c9", "tier": "explain", "kind": "indicator",           // indicator | logs | traces
      "subject": "component:checkout",
      "indicator": { "id": "indicator:component:checkout@2", "metric": "checkout/db_client_connections_usage",
                     "roles": ["saturation"], "expect": { "kind": "baseline" }, "selector": {},
                     "provenance": "derived", "subject": "component:checkout", "type": "indicator" },
      "roles": ["saturation"],
      "when": { "failingSteps": ["step:place-order#1", "step:place-order#3"] },  // absent: always run
      "rationale": "checkout serves the failing hop"
    },
    {
      "id": "c23", "tier": "corroborate", "kind": "logs", "subject": "component:checkout",
      "roles": [], "match": { "operation": "UPDATE", "table": "orders" },
      // "correlationKey": "orderId" appears when the flow drops trace context
      "when": { "failingSteps": ["step:place-order#3"] },
      "rationale": "Error logs of checkout around the hop"
    }
  ],
  "blindSpots": [{ "vertex": "component:payment-provider", "reason": "no-telemetry" }],
  "omittedChecks": 0
}
```

### Vertex ids

`<type>:<key>`: `functionality:checkout`, `flow:place-order`, `step:place-order#3`,
`dependency:checkout/orders-db`, `component:orders-pg`, `member:mysql-main/replica-1`,
`indicator:<subject id>@<n>`.

### Enumerations

| Field | Values |
|---|---|
| `checks[].tier` | `confirm`, `localise`, `explain`, `corroborate`, `impact`, in that order |
| `scope.vertices[].reason` | `entry`, `functionality`, `suspect-flow`, `step`, `path-dependency`, `path-component`, `routed-member`, `neighbour`, `contention` |
| `scope.pruned[].reason` | `unreachable`, `beyond-hop-budget`, `not-routed` |
| `blindSpots[].reason` | `no-telemetry`, `no-indicators` |

### Events (`--ndjson`)

| `type` | Carries |
|---|---|
| `investigation.started` | `query`, `system`, `environment`, `window` |
| `investigation.symptom_classified` | `symptom` |
| `investigation.entry_located` | `entry` |
| `investigation.scope_resolved` | `scope` |
| `investigation.plan_ready` | `plan` |

## Ambiguity

When the model's best candidate is under 0.5 confidence, or a runner-up is within 0.15 of it, the
entry is ambiguous. With a terminal on stdin the candidates are listed on stderr and the engineer
picks one; the entry's method is then `prompt`. Without one, the command exits 2 with
`INVESTIGATION_ENTRY_AMBIGUOUS`, naming the candidates and `--entry`.

## Error codes

`{ errorCode, message? }`, on stdout as JSON under `--json`/`--ndjson`, else on stderr.

| Code | When | Exit |
|---|---|---|
| `INVESTIGATION_INVALID_CONFIG` | an `INVESTIGATION_*` variable cannot be used. Checked at startup | 2 |
| `INVESTIGATION_EMPTY_QUERY` | the query is blank | 2 |
| `INVESTIGATION_INVALID_WINDOW` | `--since` is not a duration | 2 |
| `INVESTIGATION_ENVIRONMENT_UNKNOWN` | `--env` is not in the manifest, or it was left out and there are several | 2 |
| `INVESTIGATION_ENTRY_NOT_FOUND` | `--entry` is not a vertex, or nothing in the manifest fits the query | 2 |
| `INVESTIGATION_ENTRY_AMBIGUOUS` | several candidates fit and nobody could choose | 2 |
| `INVESTIGATION_TRIAGE_FAILED` | the model's answer stayed invalid after one retry | 1 |
| `MANIFEST_*` | see [heimdall-manifest.md](heimdall-manifest.md) | 2 |
| `LLM_MISSING_API_KEY`, `LLM_AUTHENTICATION_FAILED` | no `--entry`, and the model cannot be reached | 4 |
