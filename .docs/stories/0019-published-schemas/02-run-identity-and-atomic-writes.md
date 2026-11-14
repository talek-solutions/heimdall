# 0019-02. Run identity and atomic writes

- **Priority:** High
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) item 2
- **Decided in:** [ADR 0019](../../adr/0019-published-schemas-for-transcripts-and-scorecards.md),
  [ADR 0022](../../adr/0022-the-commit-comes-from-where-the-code-runs-with-a-dirty-flag.md)
- **Epic:** [bifrost EP-001](../../../../bifrost/.docs/epics/EP-001-read-heimdall-runs-in-a-browser.md)
- **Defended in:** [SD-001](../../defenses/SD-001-build-the-published-schemas-and-link-source-calls-to-results.md)

## Story

As an engineer reading Heimdall's files from another program, I want each file to appear whole
and to name its run and the code that made it, so that I never open a half-written file and can
tell which Heimdall change a result belongs to.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Write transcripts, scorecards and scoring sheets to `.<name>.<6 hex>.tmp` in the same directory with the same mode, then rename; the temporary file is deleted when the write fails | done |
| 2 | Sweep temporary files older than an hour when the runs directory is pruned | done |
| 3 | Give every run a `meta.runId` when it starts; a replay gets its own | done |
| 4 | Resolve `{ commit, dirty }` once at CLI start, from the entry file's directory; `null` when git or a checkout is missing | done |
| 5 | Write `meta.commit` and `meta.dirty` on the transcript, and `heimdall: { version, commit, dirty }` on the scorecard | done |
| 6 | Write `version: 1` on the scorecard and the scoring sheet | done |
| 7 | Keep the CI transcripts byte-stable: `runId` is overwritten in `stableForCommit` and the commit is `null` | done |

## Acceptance

- After a successful write no `.tmp` file remains and the file has the store's mode; after a
  write that throws, neither the `.tmp` nor a partial target remains: `atomic-write.spec.ts`.
- The temporary name matches neither `TRANSCRIPT_FILE` nor the `.json` filter of `recordedIn`:
  `atomic-write.spec.ts`, `transcript.store.spec.ts`, and `eval.service.spec.ts`, where a run
  that left one still reports its transcript.
- `prune` removes a `.tmp` older than an hour and keeps a fresh one: `transcript.store.spec.ts`.
- A recorded transcript has a `runId`; a replay's output has a different one, and
  `compareTranscripts` still reports no difference: `transcript.session.spec.ts`,
  `transcript-replay.spec.ts`.
- The commit resolver returns the hash in a checkout and in a worktree, `dirty: true` with an
  uncommitted change, and `null` outside a checkout and when git is missing; it gives the same
  answer when the working directory is a temporary directory: `build-identity.spec.ts`, against
  repositories created in a temporary directory. It also returns `null` when the code is
  installed under another checkout's `node_modules`.
- A scorecard and a sheet carry `version: 1`, and a scorecard carries `heimdall`:
  `eval.service.spec.ts`.
- Recording each CI transcript twice gives the committed bytes both times:
  `transcript-replay.spec.ts`.
- Everything written here validates against the schemas of
  [0019-01](01-schemas-and-the-pinning-spec.md): `published-schemas.spec.ts`.
- The golden files of the CLI output are unchanged: `npm test`.

## Notes

- **Where things are:** `writeFileAtomic` and `resolveBuildIdentity` are in `libs/core`
  (`files/atomic-write.ts`, `build/build-identity.ts`). The CLI provides `BUILD_IDENTITY` once in
  `cli.module.ts`, from its own directory, and the commands pass it to `TranscriptSession.begin`
  and `EvalService.run`.
- **`dirty` means tracked files only.** Untracked files are ignored, or a stray `.DS_Store` would
  mark every run. A checkout with staged but uncommitted files is dirty.
- **Installed as a dependency:** when the code sits under a `node_modules` of the enclosing
  checkout, that checkout is somebody else's project and the commit is `null`.
- **Checked by hand on 2026-11-11:** `heimdall investigate --plan-only` in fixture mode, started
  from a temporary directory, wrote a `0600` transcript with a `runId`, this checkout's HEAD as
  `commit` and `dirty: true`, left no temporary file, and validated against the schema.
- The atomic write is one helper in `libs/core`, used by `TranscriptStore`, `EvalService` and the
  sheet writer. `judge.lock.json` keeps its plain write (SD-001).
- `heimdall.version` stays `0.0.0`. Setting a real version is not part of this story and is not
  planned anywhere yet.
- `prune` can delete a file between a reader listing the directory and opening it. That race is
  the console's to handle in its import story, not solved here.
- The commit describes the checkout. A `dist` older than the sources is not detected.
