# 0022. The commit comes from where the code runs, with a dirty flag

- **Status:** Accepted
- **Date:** 2026-11-10

## Context

[0019](0019-published-schemas-for-transcripts-and-scorecards.md) adds the commit of the Heimdall
build to the transcript (`meta.commit`) and to the scorecard (`heimdall: { version, commit }`),
"`null` outside a git checkout". It does not say how the commit is found. Four things make that
less obvious than it looks:

- **The working directory is the wrong place to look.** `heimdall replay` and the runs of
  `heimdall eval` start in temporary directories, and a user runs `heimdall investigate` from
  whatever repository they happen to be in.
- **A checkout can be a git worktree,** where `.git` is a file, not a directory.
- **A checkout can have uncommitted changes.** heimdall-console marks evaluation trends by
  Heimdall change (its US-003). A run of modified code recorded under the last commit puts a
  quality change on the wrong commit.
- **`heimdall.version` names nothing yet.** It is `0.0.0` everywhere (`apps/cli/src/version.ts`),
  so the commit is the only thing that identifies a build.

## Options considered

- **Ask git, from the directory of the running entry file.** It follows the code, wherever the
  command was started, and git itself handles worktrees. It costs one or two short child
  processes at start, and it describes the source checkout, not the compiled `dist`.
- **Ask git, from the working directory.** The same cost, and the wrong repository or `null` in
  every case above.
- **Stamp the commit at build time** into a generated file. It is exact for the code that runs.
  It needs a build step that writes source, and a build of a dirty tree needs the same flag
  anyway.
- **Read `.git` by hand.** No child process. It has to reimplement worktrees and packed refs.

## Decision

**The CLI resolves the commit once, at start, by asking git from the directory of its own entry
file, and records whether the checkout was dirty.**

- **Result:** `{ commit, dirty }` or `null`. `commit` is the full hash. `dirty` is written only
  when it is `true`.
- **`null`, never an error:** git is not installed, the code is not in a checkout, or git fails
  for any reason. A run is never refused because its commit is unknown.
- **Where it goes:** `meta.commit` and `meta.dirty` on the transcript, and
  `heimdall: { version, commit, dirty }` on the scorecard. All are optional in their v1 schemas.
- **Resolved once and passed in,** as a provider at module level, not looked up where it is
  written. A replay or an eval child resolves its own.
- **Fixtures record `commit: null`,** so the CI transcripts do not change with every commit.

## Consequences

**Easy:**
- A run and a scorecard name the code behind them, from wherever the command was started.
- A reader can leave runs of modified code out of a trend, or mark them.

**Hard:**
- The commit is that of the checkout. If `dist` is older than the sources, the recorded commit is
  ahead of the code that ran.
- An installed Heimdall, outside a checkout, records `null` until it has a real version.
- Starting the CLI now runs git.

**If assumptions change:** when Heimdall is packaged and released, the version identifies the
build and the commit is stamped at build time. This ADR is then superseded.
