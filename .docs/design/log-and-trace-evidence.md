# Log and trace evidence

- **Status:** Final. Calibrated against the fixture scenarios and pinned by the specs
  [below](#pinned-by), delivered with
  [story 0018-02](../stories/0018-investigation-execution/02-logs-and-traces-evidence.md).
- **Decided in:** [ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md)

How code turns logs and spans into evidence the agent can cite. Metrics answer *where* and *since
when* ([health-evaluation.md](health-evaluation.md)); logs and traces answer *why*. They do it by
showing what is **different from the baseline**, not what is loudest. Everything here reads
records that already passed [redaction](redaction-and-scrubbers.md).

## Where it sits

```
run_checks (logs / traces checks) · search_logs · search_traces · get_trace
   ─▶ LogQL / TraceQL compiler ─▶ LogsSource / TracesSource (redacted, time-sliced)
   ─▶ log templates: window vs baseline       ─┐
   ─▶ span operations: window vs baseline      ┴▶ evidence result ─▶ agent
```

Evidence results carry **no verdict**. The agent cites them in a conclusion's `evidence`; the
conclusion validator rejects a verdict on one. The origin rule stays with the metrics.

## Queries

**LogQL** is the component's stream selector, plus `|= "<literal>"` when `search_logs` passes
`contains`. There are no parser stages: lines are parsed in code, after the allowlist, the same
way on a fixture as on Loki.

**A step's `match` on logs** keeps the lines that agree with it and **drops only the lines that
contradict it**. Around `checkout/orders-db` (`operation: UPDATE, table: orders`):
- `slow query table=stock operation=SELECT` is dropped.
- `acquire connection timeout` stays; it says nothing about the table.
- A match meaning the component maps no field to is listed as `ignored`.

**TraceQL** reads the subject's end of the hop, from the check's `hop` (caller or target) and the
dependency's mode:

| Subject is the | sync | async | Match meanings it records |
|---|---|---|---|
| caller | `kind = client` | `kind = producer` | `method`, `statusCode`, `operation` (`db.operation.name`), `table` (`db.collection.name`), `topic`, `instance` |
| target | `kind = server` | `kind = consumer` | `method`, `statusCode`, `route` (`http.route`), `topic`, `consumerGroup`, `instance` |

`statusCode` applies only as a number (`5..` is ignored), and `outcome` never applies. Without a
hop (a component entry), all of the subject's spans are read.

## Sampling

A capped query returns the newest lines of its range, so one query over the window would describe
its last minutes. Each side is therefore split into equal time slices:

| | Window | Baseline (the window of the same length before) | Queries |
|---|---|---|---|
| Logs | 4 slices × `INVESTIGATION_LOG_SAMPLE_LIMIT` (250) lines | the same | 8, plus up to 3 [confirmations](#classes) |
| Traces | 2 slices × `INVESTIGATION_TRACE_SAMPLE_LIMIT` (10) traces, 25 spans each | the same | 4 |
| Error traces | one search of 10, `status = error` | the same | 2 |
| Exemplar | the slowest error trace of the window, else its slowest trace | – | 1 |

**Counts are of the samples, not totals.** A logs check costs at most 11 queries and a traces
check 7, against the run's `INVESTIGATION_MAX_QUERIES` (120).

## Templates

Lines are grouped by template:
1. **The text.** A line's `message` (an unstructured line is all message), or, when it maps no
   message, the names of its mapped fields.
2. **Masking.** It is split on whitespace. A token holding a digit, or a run of 16 or more id-like
   characters, becomes `<*>`, and runs of `<*>` collapse. A `[REDACTED:<scrubber>]` token stays as
   written.
3. **The id.** It is the first 8 hex characters of the template's SHA-256, stable across runs and
   replays.

`LOG:  process 48211 still waiting for ShareLock on transaction 99182731 after 1234.5 ms` becomes
`LOG: process <*> still waiting for ShareLock on transaction <*> after <*> ms`.

## Classes

With *share* = a template's lines ÷ the sample's lines:

| Class | Rule | The agent gets |
|---|---|---|
| **new** | absent from the baseline sample, at least 2 lines in the window, and **a baseline query agrees** | template, counts, share, first and last seen, 2 examples (the first and the last occurrence) |
| **surging** | window share ≥ 3 × baseline share (the baseline share floored at 1 ÷ its sample size), and at least 5 lines | the same |
| **vanished** | no lines in the window, baseline share ≥ 2% | counts only, top 3 |
| **steady** | the rest | counts only, top 5; **with examples in a search for literal text** (`contains`), since the agent asked for those lines |

**Confirmation.** A sample can miss a rare baseline line, and a false "new" would mislead the
agent. So the 3 most frequent new templates are looked for in the whole baseline window, by their
longest literal run of at least 8 characters, as a regex tolerant of repeated spaces
(`|~ \`still\s+waiting\s+for…\``):
- **Nothing found:** `confirmedAbsent: true`.
- **Found:** the template is judged as surging against the floored baseline,
  `confirmedAbsent: false`.
- **No literal to look for, or beyond the 3:** `confirmedAbsent: null`.

When the baseline sample is empty, the whole stream is new (`streamNew: true`): a job that only
ran in the window. At most 8 templates are new or surging, new ones first.

**Correlation.** A check joined on a `correlationKey` (a flow that drops trace context) lists up to
5 of the key's values from its new and surging lines. The agent searches the other side of the
hop with them (`search_logs` with `contains`).

## Span operations

The subject's spans are grouped by name. Per operation, window against baseline:

| Change | Rule |
|---|---|
| `new` | in the window sample, not in a non-empty baseline sample |
| `slower` | p50 ≥ 1.5 × the baseline's **and** at least 5 ms more; or a median share of the trace ≥ 1.5 × the baseline's |
| `errors` | it failed in more error traces than in the baseline's error sample |

Each operation also reports its p50 and p95, its share of the trace, its error traces in each error
sample, and its top 3 `error.type` values. Operations with changes come first, at most 10. The
exemplar trace is a depth-first span list from its roots, children by start time, at most 40 spans,
with allowlisted attributes and scrubbed status messages.

## Worked example

`increased-latency-1` over the 60 minutes before the anchor, the documented walk of the
[checkout README](../manifests/checkout/README.md):

| Read | Sample (window / baseline) | Evidence | Queries |
|---|---|---|---|
| `orders-pg` logs | 1000 / 1000 | 4 new: ShareLock wait (261), `Process holding the lock: 47102` (169), slow `UPDATE orders` (167), statement timeout (42, unconfirmed: beyond the 3) | 11 |
| `checkout` logs around `orders-db` | 1000 / 1000 | 4 new: `slow query` (102), `request failed` (55), `connection pool usage high` (50), `acquire connection timeout` (36). `dsn`, `customer`, `authorization` dropped | 11 |
| `orders-reconcile` logs | 612 / 0 | `streamNew`. `reconciling batch` (396, with `table=orders`, `isolation=repeatable_read`, and `txOpenSeconds` going from 1 to 2037 between the first and last example), `upstream ledger page fetched` (216) | 8 |
| `checkout` client spans to `orders-pg` | 20 / 20 traces | `UPDATE orders` slower: p50 65 ms vs 8 ms, share 0.45 vs 0.17, `PoolTimeoutError`. The exemplar's span says `pool exhausted: timed out after 5000ms waiting for a connection to orders-pg`; the statement text is dropped | 7 |
| `healthy-baseline`, `orders-pg` and `checkout` logs | 1000 / 1000 | nothing new, surging or vanished | – |

Read together, these are the explanation. A job that only runs in the window has held a
repeatable-read transaction on `orders` open for 34 minutes. Postgres shows sessions waiting on the lock held by PID
47102. `checkout`'s pool fills with blocked `UPDATE`s.

## What the agent receives

```jsonc
{
  "result": "r21", "kind": "logs", "check": "c22", "subject": "component:orders-reconcile",
  "window": { "start": "…T07:00:00Z", "end": "…T08:00:00Z" },
  "baseline": { "start": "…T06:00:00Z", "end": "…T07:00:00Z" },
  "filter": { "contains": null, "narrowedBy": {}, "ignored": [] },
  "sampled": { "window": 612, "baseline": 0, "slices": 4, "capped": true },
  "streamNew": true,
  "templates": {
    "new": [{
      "id": "1994579c", "template": "reconciling batch", "count": { "window": 396, "baseline": 0 },
      "severity": "info", "share": 0.647, "confirmedAbsent": true,
      "firstSeen": "…T07:26:00.657Z", "lastSeen": "…T07:59:56.886Z",
      "examples": [                   // the first and the last: the transaction has been open 34 minutes
        { "at": "…T07:26:00.657Z", "fields": { "severity": "info", "message": "reconciling batch",
          "table": "orders", "isolation": "repeatable_read", "txOpenSeconds": "1" } },
        { "at": "…T07:59:56.886Z", "fields": { "severity": "info", "message": "reconciling batch",
          "table": "orders", "isolation": "repeatable_read", "txOpenSeconds": "2037" } }
      ]
    }, { "id": "c305574c", "template": "upstream ledger page fetched", … }],
    "surging": [], "steady": [], "vanished": []
  },
  "correlation": null,
  "redaction": { "records": 612, "fieldsDropped": 1224, "truncated": 0, "matches": {} },
  "problem": null                     // { errorCode, message } when nothing could be read
}
```

A `traces` result carries `filter` (`side`, `operation`, `errorsOnly`, `narrowedBy`, `ignored`),
`sampled` (traces and error traces per side, and the error limit), `operations` and `exemplar`.
A `get_trace` result (`kind: trace`) carries the trace as the same span list. The local report adds
the names of dropped fields per subject; the agent never sees them.

## Known limits

- **Samples, not totals.** A rare template can be missed in both samples. Confirmation covers the
  "new" side only, and only for the three most frequent.
- **Slices still lean to their ends.** Each slice returns its newest lines. Zoom the window (from
  an onset) to read a burst.
- **A shared stream crowds itself.** An info-heavy stream leaves fewer error lines in a capped
  sample. Template diffing, not severity, is what isolates them (the Postgres evidence is at `LOG`
  level).
- **Error searches cap at their limit.** When both sides hit 10 error traces, `errors` cannot
  tell them apart; the p50 and share still can.
- **Loki's pattern endpoint** (server-side templates with real counts) would replace sampling
  where it is enabled. Not used yet: neither every deployment nor the fixtures have it.

## Pinned by

All live in `libs/investigation/src/execution/`.

| Spec | Rules |
|---|---|
| `evidence/log-evidence.spec.ts` | [Templates](#templates) and every row of [Classes](#classes): confirmation, the floored baseline, the thresholds, `streamNew`, correlation values, examples in a search |
| `evidence/trace-evidence.spec.ts` | Every row of [Span operations](#span-operations), and the exemplar's order |
| `evidence/evidence.runner.spec.ts` | Every row of [Worked example](#worked-example), read from the fixtures through the real compilers and sources, with the query costs of [Sampling](#sampling) |
| `queries/evidence-queries.spec.ts` | [Queries](#queries): selectors, quoting, the match on logs, the side table, numeric status codes, error queries, missing identities |
| `investigation-execution.e2e.spec.ts` | The `increased-latency-1` walk end to end: origin step 3, cause `orders-reconcile`, cited by its logs, within the query budget |
| `../plan/check.planner.spec.ts` | Logs and traces checks around a hop name their side |
