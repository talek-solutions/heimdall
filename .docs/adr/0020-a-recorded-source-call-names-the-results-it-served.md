# 0020. A recorded source call names the results it served

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

A transcript records every source call in `telemetry[]` and every check or evidence result in the
events, as `r1…rn`. Nothing connects the two:

- A result carries no query text and no matchers, by design (`check-result.interface.ts`).
- A recorded call (`ITelemetryExchange`) carries the operation, the source and the request, and
  no result id.
- `telemetry[]` is sorted by request when the transcript is written, so position says nothing.

A reader outside this repository cannot answer "which telemetry served `r3`".
[heimdall-console](../../../heimdall-console/.docs/user-stories/US-001-inspect-a-past-run.md)
needs that for its item 6, and the published transcript schema of
[0019](0019-published-schemas-for-transcripts-and-scorecards.md) is about to freeze the shape.
The recording and replay rules this touches are those of
[0007](0007-record-replay-and-golden-evals.md).

Facts the decision rests on, checked in the code on 2026-11-10:

- Every source call is made by the check runner or the evidence runner, inside a result id that
  was reserved before any query: seven call sites.
- No source call is cached, shared between results, or made outside a result.
- One result can make several calls: an indicator's window and baseline, a logs result's
  confirmations, a trace's exemplar.
- A result can make no call at all: a query that does not compile, or a missing source.

## Options considered

- **Heimdall records the result id on each call.** An optional argument goes through the four
  source operations and the two runners. The sort needs a tie-break. Transcripts recorded before
  this never get the link.
- **A matching rule, applied by the reader** (indicator, window, source). No change here. The
  reader has to recompile PromQL, LogQL and TraceQL to match a request, breaks silently when a
  compiler changes, and cannot tell apart the several calls one evidence result makes.
- **Call references on the result.** Results go to the model, so this changes the agent's input
  and every golden transcript. Call order is also not stable until the final sort.
- **Ambient context** (`AsyncLocalStorage`) instead of an argument. Nothing in the signatures
  shows the coupling, and the repo has no precedent for it.

## Decision

**Each recorded source call carries the ids of the results it served, in an optional
`resultIds`.**

- **Shape:** `resultIds: string[]`, at least one item when present, on `ITelemetryCall` and on
  `ITelemetryExchange`. The name avoids `results`, which would sit next to `result` on the same
  object. It is an array so that a call shared between results later needs no new version.
- **Who sets it:** the runner passes the id it reserved to the source operation, as an optional
  argument. The interceptor writes it on the exchange. The model never sees it.
- **Version:** the field is optional in the transcript v1 schema, under the compatibility rule of
  0019.
- **Recording:** `resultIds` is not part of a call's identity (operation, source, request), so
  replay matches calls as before. The final sort breaks identity ties on `resultIds`, so two
  identical requests that served different results are written in the same order every time.
- **Replay:** a replayed exchange carries the tag of the live call, not the recorded one. When
  the recording has tags, `heimdall replay` reports a difference in them. A recording without
  tags replays as before.
- **When a run counts as linked:** its telemetry is empty, or at least one entry carries
  `resultIds`. A result with no entry in a linked run made no call.

## Consequences

**Easy:**
- A reader opens the raw telemetry behind a result with a filter, not a guess.
- A change that breaks the link fails replay in CI.

**Hard:**
- The redacting sources' public operations gain an argument that is about recording, not about
  telemetry.
- Transcripts recorded before this stay unlinked for good, and a reader has to say so.
- Once a reader depends on the field, removing or renaming it is a new transcript version.

**If assumptions change:** if source calls are ever cached, deduplicated or shared between
results, one exchange serves several results. The array already allows it, but the rule for who
sets the tag has to be decided again.
