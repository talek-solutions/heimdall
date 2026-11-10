# 0019-01. Schemas and the pinning spec

- **Priority:** High
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) item 2
- **Decided in:** [ADR 0019](../../adr/0019-published-schemas-for-transcripts-and-scorecards.md),
  [ADR 0021](../../adr/0021-schemas-are-identified-and-referenced-by-urn.md)
- **Defended in:** [SD-001](../../defenses/SD-001-build-the-published-schemas-and-link-source-calls-to-results.md)

## Story

As an engineer building a reader of Heimdall's files, I want a published schema for every format
and version, kept true by a spec, so that my reader validates a file before showing it and a
format change fails in Heimdall's CI, not on my page.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Publish `transcript.v1.schema.json`: meta, environment, pins, model, telemetry and outcome, with events specified in full by `type` and the plan in full; telemetry results and model messages stay open | done |
| 2 | Publish `report.v1.schema.json`, with one branch for `schemaVersion: 1` and one for the reports recorded before it | done |
| 3 | Publish `scorecard.v1.schema.json`: both token shapes, and `judge` with its optional embedded `lock` | done |
| 4 | Publish `scoring-sheet.v1.schema.json` | done |
| 5 | Give each schema its URN `$id`, and refer from one schema to another only by that id | done |
| 6 | Validate the four CI transcripts and a fixture of every other shape against the schemas, with Ajv as an exact-pinned dev dependency | done |
| 7 | Describe the files as written, including the `{ "$number": "NaN" }` encoding | done |

## Acceptance

- Every schema compiles after all four are registered, and a `$ref` to an unknown id fails:
  `published-schemas.spec.ts`.
- The four transcripts in `libs/investigation/src/__fixtures__/transcripts/` validate:
  `published-schemas.spec.ts`.
- A fixture of each of these validates: a transcript with a pre-v1 report, a failed run, a
  plan-only run, a scorecard with `tokens.agent`, one with `tokens.investigation`, one whose only
  run failed, one with a passing `judge.lock`, and a scoring sheet parsed from YAML:
  `published-schemas.spec.ts`.
- A copy of a fixture with a renamed required field is refused, and the error names the path:
  `published-schemas.spec.ts`.
- A file with an unknown extra property validates, at every object level the schemas close:
  `published-schemas.spec.ts`.
- Ajv is in `devDependencies` with an exact version and in no lib's `dependencies`: the spec
  reads the `package.json` files.
- Every file under a Heimdall home validates when `HEIMDALL_SCHEMA_CHECK_HOME` names it:
  `published-schemas.spec.ts`, skipped otherwise. It reads in place and copies nothing.

## Notes

- **Where things are:** the spec is `libs/evals/src/schemas/published-schemas.spec.ts`, in the one
  lib that depends on all the others and already reads YAML. Its helper,
  `published-schemas.fixture.ts`, is the only file that imports Ajv. Fixtures sit beside the
  schemas, in `libs/transcript/schema/__fixtures__` and `libs/evals/schema/__fixtures__`.
- **Closed where a reader branches:** event types, result kinds and every enum are listed, so a
  new event type or enum value is added to the v1 schema in the same change. That widens the
  schema and keeps every older file valid. A reader on an older copy refuses the new file until
  it syncs, which is the loud failure heimdall-console ADR 0002 asks for.
- **Open on purpose:** `model[].request` and `response`, `telemetry[].request` and `result`, a
  pin's `value`, an indicator's `expect` beyond its `kind`, and a sheet's `conclusion` and
  `citedResults`.
- **`$number`:** every measured value (medians, peaks, durations, profile points) accepts the
  encoded form. No file recorded so far contains one.
- **History check:** `HEIMDALL_SCHEMA_CHECK_HOME=~/.heimdall node --test
  libs/evals/dist/schemas/published-schemas.spec.js` validates a Heimdall home in place. On
  2026-11-10 it passed on 24 files: 14 transcripts, 3 scorecards and 7 sheets.
- **`report-before-v1.json` is not replayable:** its model and telemetry exchanges are cut to one
  of each kind. Its events, plan and report are whole.
- Fixtures for old shapes are hand-reduced from fixture-mode runs. Nothing recorded against a
  real backend enters the repo.
- No `judge.lock.json` has been written yet, so the lock fixture is built from
  `ICalibrationLock`. The lock file itself is out of scope (SD-001).
- The fields of [0019-02](02-run-identity-and-atomic-writes.md) and
  [0019-03](03-source-call-linked-to-its-result.md) are optional in these schemas from the
  start, so this slice can ship first and the other two do not change a schema's version.
- The schemas become the `Specified in` of this folder. `.docs/design/replay-and-evals.md`, "The
  transcript", links to them when this ships.
