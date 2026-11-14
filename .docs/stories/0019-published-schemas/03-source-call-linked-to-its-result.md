# 0019-03. Source call linked to its result

- **Priority:** High
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) item 2
- **Decided in:** [ADR 0020](../../adr/0020-a-recorded-source-call-names-the-results-it-served.md)
- **Epic:** [bifrost EP-001](../../../../bifrost/.docs/epics/EP-001-read-heimdall-runs-in-a-browser.md)
- **Defended in:** [SD-001](../../defenses/SD-001-build-the-published-schemas-and-link-source-calls-to-results.md)

## Story

As an engineer judging a past run, I want each recorded source call to name the result it
served, so that I can open the raw telemetry behind a result exactly as the run saw it.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Carry optional `resultIds` on `ITelemetryCall`, through the four source operations, without changing what a source queries or returns | done |
| 2 | Pass the reserved result id from the check runner and the evidence runner at all seven call sites | done |
| 3 | Record `resultIds` on each exchange, for a call that fails as well as one that succeeds | done |
| 4 | Write two calls with the same identity in the same order every time, by breaking sort ties on `resultIds` | done |
| 5 | Replay with the live call's tag, and report a difference in `resultIds` when the recording has them | done |
| 6 | Replay a transcript recorded before the link, unchanged | done |
| 7 | Re-record the four CI transcripts with the link | done |

## Acceptance

- Every call made by an indicator check, a logs result, a traces search and a trace fetch
  carries the id of its result, including baseline, confirmation and exemplar calls:
  `result-links.spec.ts`.
- A source's call and its redacted result are the same with and without `resultIds`, for all
  four operations: `telemetry-source.interceptor.spec.ts`. The egress guard still passes:
  `egress.guard.spec.ts`.
- Two calls with the same operation, source and request, completed in either order, give the
  same transcript text: `transcript.session.spec.ts`.
- Replaying a recording whose tag was changed by hand diverges, and the diff names the call and
  the result it served: `replay.comparison.spec.ts`, `transcript-replay.spec.ts`.
- A fixture transcript without `resultIds` replays with no difference: `transcript-replay.spec.ts`.
- In each re-recorded CI transcript, every telemetry entry has exactly one result id, and it is
  a result of that run of the kind its operation serves: `published-schemas.spec.ts`.
- Two equal requests made for two results each get their own recording back on replay, in
  whichever order the live run asks: `transcript.session.spec.ts`.
- The prompts and tool results in the re-recorded transcripts are unchanged, and so are the CLI
  golden files: the diff of `npm run transcripts:record`, and `npm test`.

## Notes

- **Replay matches by the tag too.** Sorting ties by `resultIds` means the order in the file is
  no longer the order the calls finished in. So among recorded calls with the same request, a
  replay takes the one that served the same results. ADR 0020 says matching is unchanged; this
  refines it for equal requests only, and a recording without tags replays in order as before.
- **`IReplayDiff.telemetry` gained `relinked`,** shown by `heimdall replay` as "asked for another
  result". A non-empty list diverges the replay, strict or not.
- **The sources take an optional third argument,** `{ resultIds }`. It goes to the interceptor
  only: never into the request, the query span or a backend.
- **Re-recording added one `resultIds` line to each of the 157 recorded calls** and changed
  nothing else: not their order, not a prompt, not a tool result.
- **Checked by hand on 2026-11-11:** `heimdall replay` on `increased-latency-1.json` matches
  (79 calls). On a real run recorded on 2026-10-31, before the link, telemetry and tool results
  are identical with and without this change; that replay diverges only on the report sections
  the run predates, as it did before.
- A result can make no call (a query that does not compile, a missing source). A run counts as
  linked when its telemetry is empty or any entry carries `resultIds`.
- Transcripts recorded before this stay unlinked. A reader shows them as not linked.
- This unblocks heimdall-console
  [US-001](../../../../heimdall-console/.docs/user-stories/US-001-inspect-a-past-run.md) item 6,
  and is dependency 3 of bifrost's
  [EP-001](../../../../bifrost/.docs/epics/EP-001-read-heimdall-runs-in-a-browser.md).
- Depends on [0019-01](01-schemas-and-the-pinning-spec.md) for the schema that lists the field.
