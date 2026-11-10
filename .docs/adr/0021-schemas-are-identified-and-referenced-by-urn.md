# 0021. Schemas are identified and referenced by URN

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

[0019](0019-published-schemas-for-transcripts-and-scorecards.md) puts each JSON Schema next to
the code that writes its file, and says the transcript schema `$ref`s the report schema. It does
not say how one schema names another.

Two things constrain the answer:

- **The reader moves the files.** heimdall-console copies every schema into one flat folder,
  `libs/formats/schemas/` (heimdall-console ADR 0002). A reference by relative path, from
  `libs/transcript/schema/` into `libs/investigation/schema/`, does not survive the copy.
- **The libs have a direction.** `libs/investigation` depends on `libs/transcript`, not the other
  way round. A path from the transcript schema into the investigation lib points against it.

## Options considered

- **Absolute URN ids.** Every reader has to register all the schemas with its validator before
  compiling any of them. Nothing resolves over the network.
- **Relative file paths.** They need no registration, and they break as soon as the files are
  vendored into another layout.
- **One bundled schema file.** One file to copy. It needs a build step, and every change to any
  format shows up as a diff of the whole bundle.
- **`https://` ids.** The convention most tools expect. They name a host that does not exist, and
  some validators try to fetch them.

## Decision

**Every published schema has an absolute `$id` of the form
`urn:heimdall:schema:<format>:v<version>`, and a schema refers to another only by that id.**

| Schema file | `$id` |
|---|---|
| `libs/transcript/schema/transcript.v1.schema.json` | `urn:heimdall:schema:transcript:v1` |
| `libs/investigation/schema/report.v1.schema.json` | `urn:heimdall:schema:report:v1` |
| `libs/evals/schema/scorecard.v1.schema.json` | `urn:heimdall:schema:scorecard:v1` |
| `libs/evals/schema/scoring-sheet.v1.schema.json` | `urn:heimdall:schema:scoring-sheet:v1` |

- **An id never changes and is never reused.** A new version of a format is a new file with a new
  id, and the old one stays (0019).
- **References inside one file** stay local (`#/$defs/…`).
- **The pinning spec registers all schemas, then compiles each.** An id that does not resolve
  fails there.
- **The schema files stay where 0019 put them.** The transcript schema names the report schema by
  id, so no package depends on another because of it.

## Consequences

**Easy:**
- The schemas can be copied into any layout and still resolve.
- The lib dependency direction is untouched.

**Hard:**
- A reader that loads one schema alone gets an unresolved reference. It has to load the set.
- The ids are a contract of their own: the console's lock and validator depend on them.

**If assumptions change:** if the schemas are ever published at a real address, the URNs stay as
ids and the address becomes where to fetch them, not what they are called.
