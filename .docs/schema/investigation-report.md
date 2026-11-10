# `heimdall investigate`: the investigation report

What an execution ends with ([ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md),
amendment), for [US-001](../user-stories/US-001-on-demand-investigation.md) item 3 and story
[0018-03](../stories/0018-investigation-execution/03-mitigations-and-report.md). One typed object,
`IInvestigationReport` in `libs/investigation`, shown three ways and stored once.

**The model writes only the conclusion.** Everything the report says around it (key figures, the
blind spots it leans on, impact, profiles) is derived by code in `ReportBuilder`, so impact can
never read as a cause and every rule is tested without a model.

## Where it appears

| Surface | What |
|---|---|
| `heimdall investigate` (text) | The report on stdout after the plan; progress stays on stderr (ADR 0006) |
| `heimdall investigate --json` | The report as one JSON object, with `transcript` when one was recorded |
| `heimdall investigate --ndjson` | The last event, `investigation.concluded`, carries `report` |
| `heimdall report [run]` | A recorded run's report again, from its transcript: no model, no backend, no tokens |
| The run's transcript | `outcome.report` in `~/.heimdall/runs/*.json`: the report's only store |

## Fields (schema version 1)

The published JSON Schema is
[`report.v1.schema.json`](../../libs/investigation/schema/report.v1.schema.json)
(`urn:heimdall:schema:report:v1`). It also accepts the reports recorded before `schemaVersion`
existed, and it holds the definitions of the plan and of each result kind
([ADR 0019](../adr/0019-published-schemas-for-transcripts-and-scorecards.md)).

| Field | Content |
|---|---|
| `schemaVersion` | `1`. Bumped only by a breaking change; adding a field is not one |
| `outcome` | `cause-found`, `no-signal` or `inconclusive` |
| `conclusion` | Written by the model, checked by the `ConclusionValidator`: summary, cause, origin, verdicts, evidence, confidence, mitigations. Absent when the agent ended without one |
| `agentReason` | Why there is no conclusion: `no-stop-call`, `refused`, `pause-limit` |
| `keyFigures` | Result ids worth reading first, at most 5 ([Key figures](#key-figures)) |
| `blindSpots` | The plan's blind spots that the conclusion leans on, each with `touches`: `cause`, `origin` or `evidence` |
| `impact` | `status` and `subjects` ([Impact](#impact)) |
| `plan` | The plan the run executed ([investigation-plan.md](investigation-plan.md)), with every blind spot in scope |
| `results` | Every result, exactly as the agent saw it. Shapes in [health-evaluation.md](../design/health-evaluation.md#what-the-agent-receives) and [log-and-trace-evidence.md](../design/log-and-trace-evidence.md#what-the-agent-receives) |
| `profiles` | By result id, the window of each indicator result in 12 points ([Profiles](#profiles)). **Never sent to the model** |
| `redaction` | `totals` (the counts the agent saw) and `droppedFields`, names of fields the allowlist dropped per subject. **The names are in this local report only** (ADR 0008) |
| `reachedPruned` | Pruned vertices the agent looked at anyway, with its reasons |
| `usage` | Turns, tool calls, queries, tokens, time |
| `traceId` | When tracing is on |
| `transcript` | Under `--json` only: the path of the run's transcript |

### Key figures

At most 5, picked in this order, without repeats:
1. **The symptom:** unhealthy results of `confirm` checks.
2. **The origin:** unhealthy results of the origin step.
3. **The cause:** its unhealthy results. A cause without indicators is a blind spot, so its cited
   logs and traces results stand in for it.
4. **Breached objectives** not already picked.

A result is unhealthy by the conclusion's verdict when it gave one, else by code's reading:
objective verdicts first, then the preliminary signal (`anomalous` is unhealthy). Impact results are
never key figures. Without a conclusion, only 1 and 4 apply.

### Impact

What else is hurt: read from the plan's `impact` checks, never from the conclusion.

| `status` | Meaning |
|---|---|
| `not-planned` | The scope has no impact flows (an entry that is a functionality or a flow) |
| `not-run` | Impact checks were planned and none ran |
| `checked` | At least one ran |

Each subject has the worst `verdict` of its results (`unhealthy`, then `no-data`, then `healthy`), or
`null` when its checks did not run: an unchecked flow is never shown as healthy.

### Profiles

```jsonc
"r19": {
  "points": [0.619, 0.6488, 0.5965, 0.8632, 0.69, 225.5, 525.5, 825.5, 1125, 1425, 1725, 2040],
  "bucketSeconds": 300,
  "shape": "ramp",          // flat | step | ramp | spike
  "state": "ongoing",       // ongoing | recovering | recovered; null when flat
  "last": 2040
}
```

- **Points:** the window in 12 buckets. Each keeps its worst value in the deviation's direction
  (the highest for a rise, the lowest for a drop), so a burst shorter than a bucket still shows.
  `null` marks a bucket with no data. Computed in the check runner, which is the only place that
  still holds the series.
- **A bucket deviates** by the thresholds of the deviation calculator (`INVESTIGATION_DEVIATION_Z`
  and `INVESTIGATION_DEVIATION_MIN_EFFECT_PERCENT`).
- **Shape**, from the excursion that holds the worst bucket:
  - `flat`: no bucket deviates
  - `spike`: 3 buckets or fewer, and no longer at its peak
  - `step`: within 80% of its peak one bucket after it starts
  - `ramp`: takes longer than that
- **State**, from the last bucket with data:
  - `recovered`: it no longer deviates
  - `ongoing`: still within 80% of the peak
  - `recovering`: in between

Profiles show what the backend returned: production Prometheus halves a short burst inside a
`rate()` window ([health-evaluation.md](../design/health-evaluation.md#known-limits)).

## Text

In reading order: what is wrong and what to do, how far to trust it, then the proof. From the
`increased-latency-1` CI transcript:

```text
key figures    times in UTC
  functionality:checkout kpi       110/s → 80/s (-27%)
                                   ███▇▇▇▆▂▂▁▁▁  step down at 07:36, still 84.4/s
  flow:place-order latency         166ms → 2.24s (13.5×)   breached p99 ≤ 1s at 07:34
                                   ▁▁▁▁▁▁▄█████  step up at 07:30, still 2.21s
  component:orders-pg saturation   395ms → 2040s (5170×)   breached ≤ 30s at 07:26
                                   ▁▁▁▁▁▂▃▄▅▆▇█  climbing since 07:26, still 2040s

blind spots    component:orders-reconcile (the cause) has no indicators: only its logs and traces show it
               3 more in scope, outside the conclusion
impact         not checked: no impact flows in scope
```

- Sections in order: conclusion, mitigations, key figures, blind spots, impact, evidence grouped by
  subject, then pruned vertices, redaction, usage and the trace id.
- Times are UTC; under a 15-minute window they carry seconds. Numbers have 3 significant digits and
  no locale separators.
- A `no-signal` run lists every blind spot in scope, since a clean result says nothing about what
  could not be seen.
- Text is for people. The contract for machines is `--json`.

## `heimdall report`

```bash
heimdall report              # the latest run
heimdall report <transcript> --json
```

| Exit | When |
|---|---|
| 0 | The report was shown, whatever the run's outcome |
| 2 | `TRANSCRIPT_NOT_FOUND`: no recorded runs, or no file at the path |
| 2 | `TRANSCRIPT_INVALID`: the file is not a transcript this build reads |
| 2 | `REPORT_NOT_RECORDED`: the run ended without a report (`--plan-only`, or an error) |
| 2 | `REPORT_OUTDATED`: recorded before schema version 1; `heimdall replay` shows what this build makes of it |

Errors are `{ errorCode, message? }`, on stdout as JSON under `--json`, else on stderr. A run
recorded with `--no-record` has no transcript, so its report exists only in the run's own output.

## Testing

- **The JSON:** the committed CI transcripts hold each case's report, and the replay spec checks
  it byte for byte ([replay-and-evals.md](../design/replay-and-evals.md#ci-transcripts)).
- **The text:** golden files in `apps/cli/src/presentation/__golden__/`, one per CI transcript,
  rendered from its recorded report. A missing or different file fails the spec.
- **The rules:** `profile.summariser.spec.ts` covers shapes and states on synthetic series, and
  `report.builder.spec.ts` covers key figures, blind spots and impact.
- **Updating:** `npm run golden:update` re-records the transcripts and rewrites the golden files
  together. It uses the scripted model and fixture backends, so it spends no tokens. Review the diff
  as you would the report itself.

Golden files are not the golden evaluations of [ADR 0007](../adr/0007-record-replay-and-golden-evals.md),
which run a real model on demand and score conclusions.
