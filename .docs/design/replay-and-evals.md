# Replay and golden evaluations

- **Status:** Final. Every rule is pinned by the specs [below](#pinned-by), delivered with
  [story 0018-04](../stories/0018-investigation-execution/04-replay-and-golden-evals.md). The judge's
  hand-scored calibration set is still to be scored, so scorecards say **uncalibrated** until
  then.
- **Decided in:** [ADR 0007](../adr/0007-record-replay-and-golden-evals.md) and its amendment

Two tools for one question: "I changed Heimdall; did I break it, and is it better or worse?"

| | Replay | Golden evaluations |
|---|---|---|
| Answers | whether and where a change alters a run | whether conclusions are right |
| Model | the recorded one's answers, served again | the real one |
| Cost | free, no network | real tokens |
| Runs | in CI, on every commit | on demand only |

Replay cannot measure quality. The recorded model answered the old prompt and the old tool
results, so replaying its answers can only show that something it would see has changed.

## Where it sits

```
heimdall investigate ─▶ TranscriptSession (record) ─▶ ~/.heimdall/runs/<time>-<id>.json
      model calls ─▶ LLM_CALL_INTERCEPTOR ─┐
      source calls ─▶ TELEMETRY_SOURCE_INTERCEPTOR ─┤ (above redaction: ADR 0008)
      clock, sources, entry choice ─▶ pins ┘

heimdall replay <file> ─▶ child: heimdall investigate (recorded flags, variables, manifest)
      TranscriptSession (replay) answers the model, the sources and the pins
      ─▶ replayed transcript ─▶ compareTranscripts ─▶ MATCHED (0) / DIVERGED (6)

heimdall eval ─▶ libs/evals/golden/*.yaml ─▶ child per case: heimdall investigate --json (fixtures, real model)
      ─▶ report ─▶ checks (outcome, origin, cause) + judge (component, mechanism, evidence)
      ─▶ ~/.heimdall/evals/<time>/scorecard.json + sheets/*.score.yaml ─▶ (hand-scored) --calibrate
```

## The transcript

One JSON file per run.

| Section | Holds |
|---|---|
| `version` | `1`. Replay refuses versions it does not know (`TRANSCRIPT_INVALID`) |
| `meta` | Heimdall version, `recordedAt`, the command (query, `--env`, `--since`, `--entry`, `--plan-only`), the manifest's content and SHA-256, the datasource modes with the fixture scenario and anchor |
| `environment.variables` | Only `INVESTIGATION_*`, `AGENT_*`, `TELEMETRY_FIXTURE_*` and `*_DATASOURCE_TYPE`. A name that looks like a credential (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`) is dropped even then |
| `pins` | Values taken from outside the code: `now`, `sources` (URL, timeout, auth scheme and env var names only), `entryChoice`. Each is `{ value }`, or `{ error }` when computing it failed, so a replay fails the same way |
| `model` | Every model call in order, triage included: the provider-neutral request, then the response or the error. The provider's `raw` response is not kept |
| `telemetry` | Every redacting-source call: operation, source URL, the request as plain JSON, then the redacted result or the error. Sorted by request, so two recordings of a run are equal text |
| `outcome` | The investigation events (without `concluded`, whose report is below), and the plan, the report or the error |

**Encoding:**
- `NaN` and `±Infinity` are written as `{ "$number": "NaN" }`.
- Output is indented, but any value whose JSON fits in 100 characters stays on one line. A metric
  point or a log record is then one line, and a changed value is a one-line diff.
- Nothing secret goes in. Telemetry is recorded as the sources returned it, after redaction. The
  model section holds what the model was sent, which was already redacted.

## Recording

- **Every `investigate` run** is recorded, plan-only runs and failed runs included. `--no-record`
  or `HEIMDALL_RECORD=off` turns it off.
- **Where:** `HEIMDALL_RUNS_DIR`, by default `~/.heimdall/runs`, with a directory mode of 0700 and
  file modes of 0600. File names are `<recordedAt>-<6 hex>.json`. Only the newest
  `HEIMDALL_RUNS_KEEP` (20) are kept; other files in the directory are left alone.
- **The path** is printed on stderr (`heimdall: transcript …`) and included in the `--json` report
  as `transcript`. A `--plan-only` plan is printed as it was.
- **A failed write is a warning,** never a failed run.

## Replay

`heimdall replay <transcript> [--strict] [--json]` runs `heimdall investigate` again in a child
process. The child gets:
- the recorded variables, replacing any allowlisted ones in the current environment
- the recorded flags, and the recorded manifest from a temporary file
- `HEIMDALL_REPLAY` and `HEIMDALL_REPLAY_OUTPUT`
- an empty working directory, so no `.env` leaks in

Inside, the session answers:

| Call | Matched by | When it is not in the transcript |
|---|---|---|
| model | order: call 1, call 2, … | `TRANSCRIPT_REPLAY_EXHAUSTED` |
| source | operation, source and request, plus an occurrence count (parallel calls finish in any order) | `TRANSCRIPT_REPLAY_MISS` |
| pin | key | `TRANSCRIPT_REPLAY_MISS` |

A recorded error is raised again as the same kind of error, so it maps to the same exit code. No
API key is needed, and nothing reaches a model or a backend.

**What fails a replay:**

| Difference | Default | `--strict` |
|---|---|---|
| A tool result (the `TOOL` parts the model was sent), compared by call id | fails | fails |
| A source call not asked again, or one never recorded | fails | fails |
| The number of model calls | fails | fails |
| The report, the plan or the error. `usage.elapsedMs`, `traceId` and `transcript` are never compared | fails | fails |
| Anything else the model was sent: the system prompt, the tool schemas, the messages | reported | fails |

Matched exits `0`, diverged `6`. An unreadable transcript is `2`, and a child that wrote no
transcript is `TRANSCRIPT_REPLAY_FAILED` (`1`). Here is a real output. In a copy of the
`error-burst-30s` CI transcript, one metric series was flattened, so the same model choices now
meet different tool results:

```
replay        edited-error-burst-30s.json
model calls   2 recorded · 2 replayed
model inputs  identical
tool results  1 compared · 1 differ
                call-1 run_checks: results[0].baseline.median  118.2 → 0.0012
                call-1 run_checks: results[0].baseline.spread  4.071 → 0.000012
                call-1 run_checks: results[0].direction  "down" → "up"
telemetry     32 compared · identical
report        10 differences
                events[6].result.baseline.median  118.2 → 0.0012
                events[6].result.baseline.spread  4.071 → 0.000012
                events[6].result.direction  "down" → "up"
DIVERGED (exit 6)
```

## CI transcripts

`libs/investigation/src/__fixtures__/transcripts/` holds the three fixture walks, recorded by the
scripted model of the e2e spec:
- `error-burst-30s` (`--since 2m`)
- `increased-latency-1` (`--since 60m`, with `INVESTIGATION_LOG_SAMPLE_LIMIT=40` to keep the
  file small)
- `healthy-baseline` (`--since 60m`)

The replay spec replays each in strict mode, byte for byte, with HTTP datasources and a `fetch`
that throws. `npm run transcripts:record` re-records them for free after a deliberate change. A
recording is byte-stable: `recordedAt` is set to the anchor and `usage.elapsedMs` to 0, the two
values that vary between runs.

## Known limits

- **A divergence cascades.** The recorded answers keep being served after the first difference,
  so later tool calls may no longer fit what the replayed run saw. Read the first difference.
- **Replay checks Heimdall's code, not the provider's.** Model calls are recorded in the
  provider-neutral shape, so provider wire quirks are covered by the adapter's own specs.
- **A transcript is as sensitive as the evidence it holds.** It is redacted, but it is incident
  data: kept locally, owner-only, and pruned.

## Golden cases

`libs/evals/golden/<name>.yaml`, one known incident each, with the right answer written from its
README walk:

```yaml
name: increased-latency-1
description: Checkout is slow because a batch job holds a long transaction on orders
manifest: ../../../.docs/manifests/checkout/manifest.yaml   # relative to this file
scenario: increased-latency-1
anchor: '2026-10-17T08:00:00.000Z'
query: checkout is slow
since: 60m
# entry, environment and env (INVESTIGATION_* or AGENT_* only) are optional
reference:
  outcome: cause-found
  origin: step:place-order#3
  cause: component:orders-reconcile
  mechanism: >-
    The orders-reconcile batch job … holds a repeatable-read transaction on the orders table …
  evidence:
    - the place-order p99 SLO is breached, and step 3 (UPDATE orders) is the deepest slow hop
    - …
```

There are three cases: `error-burst-30s`, `increased-latency-1`, and `healthy-baseline` as the
control, where nothing is wrong and nothing may be blamed. A case runs triage, as a real report
would, unless it names an `entry`. A malformed case is `EVAL_CASE_INVALID` and names the file
and the field.

## Running the golden set

`heimdall eval [--case <names...>] [--repeat <n>] [--json]` runs each case `n` times (default 1).
**It spends real tokens and never runs in CI.**
- **How a case runs.** It runs as `heimdall investigate --json` in a process of its own, from the
  current working directory, so `.env` and `ANTHROPIC_API_KEY` apply. Its fixture scenario and
  anchor are set, and the developer's own `INVESTIGATION_*` and `AGENT_*` are left out, so cases
  stay comparable. Each run is recorded like any other, and its transcript path is in the
  scorecard for `heimdall replay`.
- **What is checked.** Code checks the outcome, the origin step and the cause vertex: `pass`,
  `fail`, or `n/a` where the reference has no answer. Then the judge scores the run. A run that
  ended in an error fails its checks, and the judge is not asked.
- **Where it goes.** The scorecard is written to `EVAL_OUTPUT_DIR`, by default
  `~/.heimdall/evals/<time>/scorecard.json`, alongside one blank scoring sheet per run. Text prints
  a row per run, the means, the tokens spent, and whether the judge is calibrated.

| Variable | Default | Meaning |
|---|---|---|
| `EVAL_JUDGE_MODEL` | `claude-opus-5-5` | The judge's model. A calibration counts only for the model it was made with |
| `EVAL_GOLDEN_DIR` | `libs/evals/golden` | The cases |
| `EVAL_CALIBRATION_DIR` | `libs/evals/calibration` | The hand-scored sheets and `judge.lock.json` |
| `EVAL_OUTPUT_DIR` | `~/.heimdall/evals` | Scorecards and scoring sheets |

**Error codes:** `EVAL_CASE_INVALID`, `EVAL_CASE_NOT_FOUND`, `EVAL_CALIBRATION_TOO_SMALL` and
`INVALID_FLAG_VALUE` exit 2. `EVAL_RUN_FAILED` and `EVAL_JUDGE_FAILED` are recorded on a run in
the scorecard, never thrown.

## The rubric

The judge is an agent run on the runtime of ADR 0017. Its only tool is a strict `score` tool, and
its budget is 3 turns. It sees the reference, the conclusion, and only the results the conclusion
cites, never the whole transcript.

| Dimension | 2 | 1 | 0 |
|---|---|---|---|
| `component` | the reference's cause, or the same component under another id | a vertex on the way to it, or one that shares the failure (the database a job is locking, instead of the job) | another component, or none when the reference has one |
| `mechanism` | the same mechanism, in any words | the right chain of symptoms with the wrong or a missing root | a different mechanism, or none |
| `evidence` | the claim follows from the cited results | they show part of it; a key step is asserted without a result | they do not support it, or nothing is cited |

When the reference expects no signal, `component` and `mechanism` are 2 when the conclusion finds
nothing wrong without inventing a cause, and 0 otherwise. `evidence` is 2 when the conclusion
cites healthy results for what it checked. A score outside 0 to 2, or without a reason, is sent
back as a tool error.

## Calibration

The judge is a model and can be wrong. An uncalibrated judge reads like a signal and is trusted,
which is worse than no eval (ADR 0007).
1. **Score by hand.** `heimdall eval` writes a sheet per run, `sheets/<case>-<n>.score.yaml`,
   holding exactly what the judge saw. The scores are left blank, so the judge's numbers cannot
   anchor yours. Score each dimension 0, 1 or 2 by the rubric, and move the sheet to
   `libs/evals/calibration/`.
2. **Calibrate.** `heimdall eval --calibrate` judges every fully scored sheet. It needs at least
   **5** (`EVAL_CALIBRATION_TOO_SMALL` otherwise). It **passes** when, for every dimension, the
   judge gives the hand score exactly on **80%** or more of the sheets and is never **off by 2**.
3. **The lock.** `judge.lock.json` records the judge model, when it was calibrated, the number of
   sheets, the agreement and largest deviation per dimension, and whether it passed. A scorecard
   says **calibrated** only when a passing lock matches `EVAL_JUDGE_MODEL`. Changing the judge
   model means calibrating again.

## Pinned by

| Spec | Rules |
|---|---|
| `libs/transcript/src/format/transcript.codec.spec.ts` | Numbers JSON cannot hold, one line per short value, versions and shape refused, canonical keys, the variable allowlist and the credential rule |
| `libs/transcript/src/store/transcript.store.spec.ts` | Retention, other files left alone, owner-only modes, a missing transcript |
| `libs/transcript/src/session/transcript.session.spec.ts` | Idle until a run begins, snapshots taken when a call is made, no `raw`, pins as values or errors, replay by order and by request, exhausted and miss |
| `libs/transcript/src/replay/json-diff.spec.ts` | Difference paths and the limit |
| `libs/investigation/src/execution/transcript-replay.spec.ts` | Each CI transcript replays byte for byte with the model and backends sealed; a changed prompt is reported, and fails only when strict; changed tool results fail; an unrecorded source call is named |
| `apps/cli/src/commands/replay/replay.e2e.spec.ts` | `investigate` records into `~/.heimdall/runs` and not with `--no-record`; `replay` exits 0 on a match and 6 on a divergence; a missing transcript exits 2 |
| `libs/evals/src/cases/golden-case.loader.spec.ts` | The three committed cases load with existing manifests; an unknown case is named; a malformed case names its file and field; `env` takes only `INVESTIGATION_*` and `AGENT_*` |
| `libs/evals/src/score/checks.spec.ts` | Outcome, origin and cause: exact matches pass, `n/a` without a reference answer, a failed run fails |
| `libs/evals/src/score/judge.spec.ts` | One strict `score` tool, the rubric prompt and model, a score outside 0 to 2 sent back and the judge failing within its budget, only cited results shown |
| `libs/evals/src/calibration/calibrator.spec.ts` | The 80% and off-by-2 rules, at least 5 scored sheets with blanks ignored, the lock and its judge model |
| `libs/evals/src/eval.service.spec.ts` | A case runs as `investigate --json` with its fixture, is checked, judged and given a blank sheet; a failed run is not judged |
| `apps/cli/src/commands/eval/eval.e2e.spec.ts` | Without tokens: a failed run in the scorecard, an unknown case and `--repeat 0` exit 2, calibration without sheets exits 2 |
