# 0019. Published schemas for transcripts and scorecards

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Files Heimdall writes now have a reader outside this repository.
[heimdall-console](../../../heimdall-console/README.md) is a local web console in its own
repository. It imports run transcripts, eval scorecards and scoring sheets, and shows them in a
browser (heimdall-console ADR 0002). Until now, their only readers were `heimdall replay`,
`heimdall report` and Heimdall's own specs, which compile against the same types that write them.

Four things stand in the way of an outside reader:

1. **The formats are defined only by TypeScript interfaces, and those describe today's code, not
   the files on disk.**
   - `ITranscript` types `events`, `plan`, `report` and `datasources` as `unknown`
     (`transcript.interface.ts`).
   - `IInvestigationReport` requires `schemaVersion`, `keyFigures`, `blindSpots`, `impact` and
     `profiles`. Every transcript recorded so far is `version: 1` and has none of them.
2. **"Version 1" already covers more than one shape.**
   - The transcript's report changed shape without the transcript changing version.
   - The scorecard has no `version`, and it changed shape too: `tokens.agent` before 2026-11-01,
     `tokens.investigation` since.
3. **Files are written with a single `writeFileSync`** (`TranscriptStore.save` and `write`,
   `EvalService`). A reader watching the directory can open a file that is half written.
4. **Nothing identifies a run or the code that made it.**
   - The transcript's 6-hex suffix is created at save time.
   - `meta.heimdall` is `0.0.0` in every transcript.
   - Scorecards record no version or commit at all.

## Options considered

- **Generate the schemas from the TypeScript types.** `ts-json-schema-generator` and
  `typescript-json-schema` each bring their own TypeScript 5.9, and Heimdall's `tsconfig` uses
  nothing that only 7 has, so they would run. But the result describes today's types:
  - It would be too loose where the types are `unknown`.
  - It would be too strict where history differs from today, refusing every report recorded so
    far.
  - It could serve as a drift check later, not as the contract.
- **Publish the types as a package.** It needs a registry, it ties readers to TypeScript 7, and
  it checks nothing about files already on disk.
- **Write the JSON Schemas by hand, and pin them with a spec against real files of every shape.**
  Someone writes and maintains the schemas. A schema that disagrees with what Heimdall writes, or
  once wrote, becomes a failing test, not a surprise for a reader.
- **Do nothing; readers parse defensively.** Every reader rediscovers the format, and a renamed
  field shows up as a blank page in the console.

## Decision

**Heimdall publishes a hand-written JSON Schema (draft 2020-12) for each format and version, and
a spec keeps them true against files of every shape that exists.**

### The schemas

Each lives next to the code that writes its file:

| Schema | Selected by |
|---|---|
| `libs/transcript/schema/transcript.v1.schema.json` | `version` |
| `libs/investigation/schema/report.v1.schema.json`, `$ref`'d by the transcript | `schemaVersion`. One branch for v1, and one for the reports recorded before it, which have none |
| `libs/evals/schema/scorecard.v1.schema.json` | `version`, absent on older files. Accepts both token shapes |
| `libs/evals/schema/scoring-sheet.v1.schema.json` | `version`, absent on older files |

- **They describe the files as written,** including the `{ "$number": "NaN" }` encoding.
- **Events are specified in full,** by `type`, and so is the plan. Telemetry results and model
  messages stay open (`additionalProperties`) in v1: they are large, provider-shaped, and readers
  show them rather than interpret them.

### The compatibility rule

- **A version's schema accepts every file ever written under it.**
- **A field added within a version is optional in that version's schema,** even when today's code
  always writes it.
- **Anything else is a new version with a new schema file:** a removed, renamed or retyped field,
  or a field made required.
- **Old schema files stay,** because files already on disk still use them. `heimdall replay`
  already refuses transcript versions it does not know (`TRANSCRIPT_INVALID`).
- **Objects allow unknown properties,** so an added optional field never breaks a reader on the
  previous schema.

### Pinned by a spec

These files are validated against the current schemas:
- the four CI transcripts in `libs/investigation/src/__fixtures__/transcripts/`
- new fixtures for the shapes those four do not cover:
  - a transcript with a pre-v1 report
  - a failed run
  - a plan-only run
  - a scorecard with `tokens.agent` and one with `tokens.investigation`
  - a scoring sheet

The validator (Ajv) is an exact-pinned dev dependency, never a runtime one.

### New fields, all optional, so version 1 stays

- **`version: 1` on the scorecard and the scoring sheet.** Optional (`const: 1`) in their
  schemas. Making it required would itself be a new version. Heimdall always writes it from now
  on.
- **`meta.runId` on the transcript:** an id created when the run starts, so a run can be named
  before it is saved. Live runs in the console need it (heimdall-console ADR 0005).
- **The commit of the Heimdall build:** `meta.commit` on the transcript, and
  `heimdall: { version, commit }` on the scorecard, `null` outside a git checkout.
  heimdall-console needs it to mark trends by Heimdall change (US-003).

### Atomic writes

- Transcripts (`TranscriptStore.save` and `write`), scorecards and scoring sheets are written to
  a temporary file in the same directory, with the same mode, then renamed.
- The temporary name matches neither `TRANSCRIPT_FILE` nor `recordedIn`'s `.json` filter
  (`case.runner.ts`): `.<name>.<6 hex>.tmp`.
- It is deleted if the write fails.
- A reader sees either the old state or the whole new file.

## Consequences

**Easy:**
- A reader outside the repository gets a contract it can validate against, for history as well as
  for today's files.
- A change that breaks a schema fails here, in CI, before any reader sees it.
- Atomic writes also make `heimdall replay` safe against a transcript that is still being written.
- With `meta.runId` and the commit, a run and the code behind it can be named.

**Hard:**
- The schemas are a second description of the formats, maintained by hand next to the interfaces.
- A new optional field that nobody adds to its schema still passes the spec. The schema is then
  incomplete but not wrong, and readers do not see the field until it is added. A generator-based
  drift check can close that gap later.

**Not decided here:** persisting the event stream while a run is going, which live runs in the
console need (heimdall-console ADR 0005). That is its own ADR.
