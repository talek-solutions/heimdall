# SD-001. Build the published schemas and link source calls to results

- **Status:** Approved
- **Depth:** High-level
- **Date:** 2026-11-10
- **Advances:** [US-001](../user-stories/US-001-on-demand-investigation.md) item 2
- **Resulted in:** [ADR 0020](../adr/0020-a-recorded-source-call-names-the-results-it-served.md), [ADR 0021](../adr/0021-schemas-are-identified-and-referenced-by-urn.md), [ADR 0022](../adr/0022-the-commit-comes-from-where-the-code-runs-with-a-dirty-flag.md), [story 0019-01](../stories/0019-published-schemas/01-schemas-and-the-pinning-spec.md), [story 0019-02](../stories/0019-published-schemas/02-run-identity-and-atomic-writes.md), [story 0019-03](../stories/0019-published-schemas/03-source-call-linked-to-its-result.md)

## Context

[heimdall-console](../../../heimdall-console/README.md) cannot be built until the files it imports
have a contract. [ADR 0019](../adr/0019-published-schemas-for-transcripts-and-scorecards.md) is
accepted and decides that contract, but none of it is built: there are no schema files, the
writers use a single `writeFileSync`, and `meta.heimdall` is hardcoded `0.0.0`.

ADR 0019 left three things open: how schemas name and reference each other once the console
vendors them, how the commit is resolved, and that a recorded source call carries no result id.
The last one blocks heimdall-console
[US-001](../../../heimdall-console/.docs/user-stories/US-001-inspect-a-past-run.md) item 6.

Out of scope: persisting events during a run (heimdall-console ADR 0005), a generator-based drift
check, setting a real `heimdall.version`, the `judge.lock.json` file itself, and any console code.

## Decisions taken

| Question | Answer |
|---|---|
| Settle the source-call link here or in its own defense? | Here, as zoom-in 1. It becomes ADR 0020, which must be accepted before its story starts |
| Who owns the link: Heimdall records it, or the console matches by rule? | Heimdall records it |
| What is the field called? | `resultIds`, not `results`: it sits next to `result` on the same object |
| How do schemas identify each other? | Absolute URNs, for example `urn:heimdall:schema:transcript:v1`. `$ref` points at the id, never a file path |
| What is recorded on a dirty working tree? | `commit` plus optional `dirty: true` |
| Is `judge.lock.json` in scope? | The file is not: it lives in this repo and only Heimdall reads it. The copy the scorecard embeds under `judge.lock` is described by the scorecard schema and pinned by one fixture |
| Where do the fixtures for old shapes come from? | Hand-reduced from fixture-mode runs only. Nothing recorded against a real backend enters the repo |
| One ADR for zoom-ins 2 and 3, or one each? | One each: 0021 and 0022 |

## Defense

**Goal:** every file Heimdall writes for an outside reader validates against a published schema
in CI, is written whole or not at all, names its run and commit, and each recorded source call
names the result it served.

**Footprint:** +0 apps · +0 libs · ~5 libs · ~1 app · +4 schema files · +~8 fixtures · +1 dev dependency (Ajv) · 0 breaking changes · 3 zoom-ins

### Change map

```
apps/cli [~] ─▶ libs/investigation [~] ─▶ libs/telemetry [~] ─▶ backends
   │ commit          │ schema/report.v1 [+]      │ call carries resultIds [~]
   │                 ▼                            ▼
   │            libs/transcript [~] ◀── interceptor, replay comparison [~]
   │                 │ schema/transcript.v1 [+]
   │                 ▼
   │            ~/.heimdall/runs/*.json [~]
   └─▶ libs/evals [~] ─▶ ~/.heimdall/evals/<t>/ scorecard, sheets, runs/<case>-<n>/ [~]
            schema/scorecard.v1, scoring-sheet.v1 [+]
libs/core [~]  atomic write helper [+]
schemas ┄▶ heimdall-console (vendors them later)
```

What changes: the file formats stop being whatever the code wrote and become a contract CI checks.

### What's new

| Choice | New or follows | Precedent | Zoom-in |
|---|---|---|---|
| Hand-written JSON Schema 2020-12 per format and version, pinned by a spec with Ajv | Follows | ADR 0019 | — |
| Compatibility rule: added fields optional, anything else a new version | Follows | ADR 0019, heimdall-console ADR 0002 | — |
| `version: 1` on scorecard and sheet, `meta.runId`, `heimdall: { version, commit }` | Follows | ADR 0019 | — |
| Atomic write (`.<name>.<6 hex>.tmp`, then rename) | Follows | ADR 0019 | — |
| Fixtures pin `runId` by post-processing | Follows | `stableForCommit` in `transcript-harness.ts` | — |
| A recorded source call names the results it served | New architecture, one-way door | none | Zoom-in 1 |
| Schemas identified and referenced by URN | One-way door with the console | none | Zoom-in 2 |
| Commit resolved from the running code's location | New methodology | none | Zoom-in 3 |

### API surface

```
Now                                         After
telemetry[i] { operation, source,           telemetry[i] { …, resultIds?: ["r3"] }        [+]
               request, result|error }
meta { heimdall, recordedAt, command, … }   meta { …, runId?, commit?, dirty? }           [+]
scorecard { startedAt, judge, runs, … }     scorecard { version?: 1,                      [+]
                                              heimdall?: { version, commit, dirty? }, … } [+]
sheet { … }                                 sheet { version?: 1, … }                      [+]
(no schemas)                                4 schemas, each with a URN $id                [+]
```

What changes: optional additions only, so every file already on disk stays valid under version 1.

| Surface | Change, by example | Breaking | Who depends |
|---|---|---|---|
| Transcript file | `meta.runId`, `meta.commit`, `telemetry[].resultIds: ["r3"]` | No | `heimdall replay`, `heimdall report`, console import |
| Scorecard, scoring sheet | `version: 1`, `heimdall: { version, commit }` | No | `heimdall eval`, calibrator, console US-003 |
| Schema ids | `$id: "urn:heimdall:schema:report:v1"` | No (new) | console `schemas:sync`, Ajv |
| `heimdall replay` diff | Reports a `resultIds` difference when the recording has them | No | CI, anyone replaying |
| Telemetry sources' signatures | Optional third argument on four operations | No | `libs/investigation` only |
| CLI output, and what the model receives | No change | No | users, golden files |

### Data stores

```
runs/<recordedAt>-<6hex>.json [~]        evals/<t>/scorecard.json [~]
  meta.runId, commit, dirty [+]            version, heimdall [+]
  telemetry[].resultIds [+]              evals/<t>/sheets/*.score.yaml [~]
evals/<t>/runs/<case>-<n>/*.json [~]       version [+]
  same as runs
```

What changes: files gain optional fields and appear whole or not at all.

| Store | Change | Migration | Undo |
|---|---|---|---|
| Runs and eval-run transcripts | Optional fields, atomic write | None: old files are never rewritten | Stop writing the fields |
| Scorecards and sheets | `version`, build identity, atomic write | None | Same |
| Leftover `.tmp` after a crash | `prune` sweeps `.*.tmp` older than an hour | None | Remove the sweep |
| CI fixtures | 4 transcripts re-recorded, ~8 fixtures added | `npm run transcripts:record` | git revert |

Newly stored: the commit hash of the Heimdall checkout, a dirty flag and a random run id. Newly
leaving the machine: nothing.

### Structure

```
libs/core [~] ◀── libs/transcript [~], libs/evals [~]     atomic write
libs/telemetry [~] ◀── libs/investigation [~]              call carries resultIds
transcript.v1 ┄▶ urn:heimdall:schema:report:v1             by id, no package dependency
```

What changes: no new lib and no new package dependency. The transcript schema names the report
schema by URN, so `libs/transcript` still does not depend on `libs/investigation`.

| Area | New, changed or removed | Why separate | Files (approx.) |
|---|---|---|---|
| Schema files beside their writers | New | One per format and version (ADR 0019) | 4 |
| Schema spec and fixtures; sheets parsed as YAML first | New | Pins the contract | 1 + ~8 |
| `libs/core` atomic write | New | Three writers share it | 2 |
| `libs/transcript`: store, session, `ITelemetryExchange`, `replay.comparison.ts` | Changed | `runId`, commit, `resultIds`, atomic write, tmp sweep | ~6 |
| `libs/telemetry`: `ITelemetryCall`, four source operations | Changed | Carry the result id to the interceptor | ~5 |
| `libs/investigation`: check and evidence runners (7 call sites), `transcript-harness.ts` | Changed | Pass the id they already reserve | ~4 |
| `libs/evals`: service, sheet writer, interfaces | Changed | `version`, build identity, atomic write | ~3 |
| `apps/cli` | Changed | Resolve version and commit once | ~2 |
| Docs: ADRs 0020 to 0022, 3 delivery stories, `replay-and-evals.md`, US-001 item 2, console US-001 item 6, EP-001 dependency 3 | New or changed | | ~10 |

### Trade-offs

| Choice | Optimises for | Gives up | Revisit when |
|---|---|---|---|
| Hand-written schemas | Truth about files on disk, old shapes included | A second description to maintain | A field ships that nobody added to its schema |
| Telemetry results and model messages stay open | A small, stable v1 | Readers cannot validate those parts | The console interprets them instead of showing them |
| Heimdall records the link | One exact source of truth | Pre-link runs never get it | A source call becomes shared, cached or deduplicated across results |
| Commit read at run time | No build step | It describes the checkout, not a stale `dist`; `null` when installed | Heimdall is packaged and released |
| The lock file keeps its plain write | No change to calibration | A killed calibration can leave a half-written lock, and the next eval fails on parsing it | Something other than Heimdall reads the file |

### Risks

1. **Recordings stop being reproducible:** `runId` and `commit` vary per run. Fixtures overwrite
   `runId` in `stableForCommit` and record `commit: null`. A replay mints its own `runId`; replay
   never compares `meta`, so equality holds.
2. **A too-strict schema refuses real history:** the spec validates every shape that exists: a
   pre-v1 report, a failed run, a plan-only run, both token shapes.
3. **Pruning races the console:** `prune` keeps 20 runs and an eval-run directory keeps 1, so a
   file can vanish between listing and reading. Not solved here; it belongs to the console's
   import story.
4. **`heimdall.version` stays `0.0.0`:** the commit is the only thing that names a build until
   something sets the version.
5. **Transcripts are incident data:** fixtures come from fixture-mode runs only.
6. **The lock's shape is described before a real lock exists:** no lock has been written yet, so
   the fixture is built from `ICalibrationLock`. Its fields are frozen in scorecard v1 once the
   console reads them.

### Zoom-in 1: A recorded source call names the results it served

```
Now                                        After
check.runner  id = r3                      check.runner  id = r3
  └─▶ queryRange(source, req)                └─▶ queryRange(source, req, { resultIds: [r3] })
        └─▶ telemetry[] { op, src, req,            └─▶ telemetry[] { op, src, req, result,
                          result }                                    resultIds: [r3] }
```

What changes: the id the runner already reserves travels with the call and is written beside it.

- **Why new:** nothing connects `telemetry[]` to `r1…rn` today. Results carry no query text, and
  telemetry is sorted by request.
- **Options:**
  1. Heimdall records the id on each call (chosen). It costs an optional argument through four
     operations and two runners, a tie-break in the sort, and pre-link runs stay unlinked.
  2. A matching rule the console applies. The console would recompile PromQL, LogQL and TraceQL,
     and it cannot tell apart the several calls one evidence result makes.
  3. Call references on the result. Results go to the model, so this changes agent input and
     every golden transcript.
  4. Ambient context (`AsyncLocalStorage`). Invisible coupling with no precedent in the repo.
- **Chosen:** `ITelemetryCall` and `ITelemetryExchange` both gain optional `resultIds`, with at
  least one item. It is an array so a future shared call needs no new version. All seven call
  sites already sit inside a reserved id, and no call is cached or shared. `resultIds` stays out
  of `identity()`, so replay matching is unchanged. The final sort breaks identity ties on
  `resultIds`, or two identical queries serving different results would land in completion order.
  A replayed exchange carries the live call's tag, and `compareTelemetry` reports a difference
  when the recording has tags, so a broken link fails CI.
- **Failure modes:** a failed call is recorded with its tag and its error. A result can make zero
  calls (compile failure, no source), so a run counts as linked when its telemetry is empty or
  any entry carries the tag. A pre-link transcript replays as today, and the console shows it as
  not linked.
- **Security and data:** nothing new is exposed: the id is already in the same file. Redaction
  (ADR 0008) is untouched.
- **Undo:** stop writing it. Once the console reads it, removing it from the schema is a new
  transcript version.
- **Becomes:** ADR 0020 "A recorded source call names the results it served"

### Zoom-in 2: Schemas are identified and referenced by URN

```
Now (ADR 0019 as written)                     After
transcript.v1 ─ $ref ─▶ a path into            transcript.v1 ─ $ref ─▶ urn:heimdall:schema:report:v1
                        libs/investigation     console: one flat folder, resolved by $id
```

What changes: a schema finds another by name, so the files can be copied anywhere.

- **Why new:** ADR 0019 says the transcript `$ref`s the report but not how. The console vendors
  all schemas into one flat folder (heimdall-console ADR 0002), where a relative path breaks.
- **Options:**
  1. URN ids (chosen). Every reader registers all schemas with its validator before use.
  2. Relative paths. They break on vendoring and reverse the lib dependency direction.
  3. One bundled file. It needs a build step and gives a large diff on every change.
  4. `https://` ids. They imply a host that does not exist.
- **Chosen:** each schema has `$id: urn:heimdall:schema:<format>:v<n>`, and every `$ref` between
  schemas uses that id.
- **Failure modes:** an unregistered `$ref` fails when the validator compiles, in the spec, not
  when a file is read.
- **Undo:** changing an `$id` breaks the console's lock. Ids are treated as permanent.
- **Becomes:** ADR 0021 "Schemas are identified and referenced by URN"

### Zoom-in 3: The commit comes from where the code runs, with a dirty flag

```
Now                           After
meta.heimdall = "0.0.0"       cli start ─▶ git at the entry file's directory ─▶ { commit, dirty? } | null
```

What changes: a run names the checkout that produced it, and says when that checkout had
uncommitted changes.

- **Why new:** ADR 0019 says "`null` outside a git checkout" and nothing else.
- **Options:**
  1. Resolve from the entry file's location (chosen). Replay and eval children run in temporary
     directories, so the working directory would give `null` or the wrong repository.
  2. Resolve from the working directory. Wrong for the reason above.
  3. Stamp at build time. Exact for `dist`, but it needs a build step and a generated file.
- **Chosen:** resolved once at CLI start, passed to the transcript session and the eval service.
- **Failure modes:** no git, or not a checkout: `null`, never an error. A dirty tree records
  `dirty: true`, so eval trends are not pinned on the wrong change. A stale `dist` still reports
  HEAD: named, not solved.
- **Undo:** stop writing it. The fields are optional.
- **Becomes:** ADR 0022 "The commit comes from where the code runs, with a dirty flag"

### Rollout

```
1 schemas + spec, today's and old shapes ─▶ 2 atomic writes, runId, commit, versions
  ─▶ 3 source-call link (after ADR 0020 is accepted) ─▶ 4 re-record CI transcripts
  ─▶ 5 console runs schemas:sync (its own repo and story)
```

Every step leaves existing files valid. Three delivery stories under `0019-published-schemas/`:
schemas and the pinning spec; run identity and atomic writes; source call linked to its result.

### Verification

1. Schemas → verify: the new spec validates the 4 CI transcripts and each fixture, including a
   scorecard with a passing lock; a broken copy fails naming the path
2. History → verify: the spec helper validates every fixture-mode file under `~/.heimdall`,
   copying nothing
3. Atomic write → verify: store spec: no `.tmp` after success or a forced failure, the mode is
   kept, an old `.tmp` is swept
4. Identity → verify: a new spec records twice and compares bytes; the commit spec covers a
   non-checkout, a worktree, a dirty tree and a temporary working directory
5. Link → verify: runner specs assert every call carries its id; a tie spec completes two
   identical calls in reverse order and gets the same bytes; a replay spec fails on a changed tag
   and passes on a pre-link fixture
6. Whole → verify: `npm test`, the type check and the stream guard test pass; CLI goldens are
   unchanged

## Outcome

Approved with one change: `judge.lock.json` was taken out of the atomic-write scope after a
zoom-in. Only its copy inside the scorecard is described, by the scorecard schema.

The challenge pass by the backend tech lead added the sort tie-break, the replay comparison of
`resultIds`, the URN ids, the dirty flag, the `.tmp` sweep and the rule for when a run counts as
linked.

Deferred: the race between `prune` and the console's import (risk 3), to the console's import
story; a real `heimdall.version` (risk 4), not written down anywhere yet.
