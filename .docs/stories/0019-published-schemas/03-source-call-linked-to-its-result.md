# 0019-03. Source call linked to its result

- **Priority:** High
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) item 2
- **Decided in:** [ADR 0020](../../adr/0020-a-recorded-source-call-names-the-results-it-served.md)
- **Defended in:** [SD-001](../../defenses/SD-001-build-the-published-schemas-and-link-source-calls-to-results.md)

## Story

As an engineer judging a past run, I want each recorded source call to name the result it
served, so that I can open the raw telemetry behind a result exactly as the run saw it.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Carry optional `resultIds` on `ITelemetryCall`, through the four source operations, without changing what a source queries or returns | planned |
| 2 | Pass the reserved result id from the check runner and the evidence runner at all seven call sites | planned |
| 3 | Record `resultIds` on each exchange, for a call that fails as well as one that succeeds | planned |
| 4 | Write two calls with the same identity in the same order every time, by breaking sort ties on `resultIds` | planned |
| 5 | Replay with the live call's tag, and report a difference in `resultIds` when the recording has them | planned |
| 6 | Replay a transcript recorded before the link, unchanged | planned |
| 7 | Re-record the four CI transcripts with the link | planned |

## Acceptance

- Every exchange recorded by an indicator check, a logs result, a traces search and a trace
  fetch carries the id of its result, including baseline, confirmation and exemplar calls:
  `check.runner.spec.ts`, `evidence.runner.spec.ts`.
- A source's request to its connector and its redacted result are the same with and without
  `resultIds`: the source specs. The egress guard still passes: `egress.guard.spec.ts`.
- Two calls with the same operation, source and request, completed in either order, give the
  same transcript text: `transcript.session.spec.ts`.
- Replaying a recording whose tag was changed by hand reports a telemetry difference naming
  `resultIds`: `replay.comparison` spec.
- A fixture transcript without `resultIds` replays with no difference: `transcript-replay.spec.ts`.
- In each re-recorded CI transcript, every telemetry entry has `resultIds`, and each id is a
  result in that transcript's events: `published-schemas.spec.ts`.
- The prompts and tool results in the re-recorded transcripts are unchanged, and so are the CLI
  golden files: the diff of `npm run transcripts:record`, and `npm test`.

## Notes

- A result can make no call (a query that does not compile, a missing source). A run counts as
  linked when its telemetry is empty or any entry carries `resultIds`.
- Transcripts recorded before this stay unlinked. A reader shows them as not linked.
- This unblocks heimdall-console
  [US-001](../../../../heimdall-console/.docs/user-stories/US-001-inspect-a-past-run.md) item 6,
  and is dependency 3 of bifrost's
  [EP-001](../../../../bifrost/.docs/epics/EP-001-read-heimdall-runs-in-a-browser.md).
- Depends on [0019-01](01-schemas-and-the-pinning-spec.md) for the schema that lists the field.
