# 0012. Stream discipline enforced by a guard test, not ESLint

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

ADR 0006 makes stdout data-only and names `presentation/streams.ts` as the sole
writer. That is only worth anything if it is mechanically enforced — a convention
this easy to break under deadline will be broken.

The intended mechanism was an ESLint rule. It cannot be installed: the project runs
TypeScript 7 (ADR 0003) and `typescript-eslint@8.70.0`, the current release, peers
`typescript@">=4.8.4 <6.1.0"`. There is no published version supporting TypeScript 7,
and without a TypeScript parser ESLint cannot read the sources at all.

## Options considered

- **Downgrade TypeScript to 5.x to unblock ESLint.** Trades a working, current
  compiler for a linter, on a greenfield project, to enforce one rule.
- **Skip enforcement for now.** Leaves ADR 0006 asserting a guarantee the repository
  does not provide — the worst option, because the archive stops being trustworthy.
- **Enforce with a test that scans the sources.** No new dependencies, runs in the
  existing gate.

## Decision

A guard test (`apps/cli/src/presentation/streams.guard.spec.ts`) walks every `.ts`
file under `apps/` and `libs/` and fails if any file other than `streams.ts` (or a
`.spec.ts`) references `console.*`, `process.stdout` or `process.stderr`.

## Consequences

**For this particular rule the test is stronger than the lint rule would have been.**
An ESLint violation can be waved through with an inline `eslint-disable` comment at
the exact moment someone is in a hurry — which is precisely when this rule gets
broken. A failing test cannot be silenced without an obvious, reviewable edit to the
guard itself.

**It earned its place immediately:** on its first run it caught
`cli-config.service.ts` reading `process.stdout.isTTY` directly, which had passed
review twice.

**Costs:** it is a text scan, so it cannot see through indirection — a helper that
takes a stream as a parameter would slip past. It also carries a second assertion
that a plausible number of files were scanned, so a directory-layout change cannot
make it pass by matching nothing.

**Revisit when** typescript-eslint supports TypeScript 7. A broader lint setup is
still wanted for ordinary code quality; the guard test should stay regardless, since
it enforces this rule better than lint would.
