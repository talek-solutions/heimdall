# 0006. CLI output contract

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

Heimdall is driven by a human at a terminal, but its output will inevitably be piped —
into `jq`, into a paste, into a ticket. A tool that mixes progress chatter into its data
stream can never be used that way, and the defect is unfixable later without breaking
every existing consumer.

## Decision

- **stdout is data. Everything else is stderr** — logs, progress, the banner, errors.
- `--json` emits one object; `--ndjson` emits one event per line; default is
  human-readable streaming text on stderr.
- Exit codes are a contract:
  `0` success · `1` unexpected · `2` usage · `3` no signal found · `4` provider auth ·
  `5` budget exceeded.
- `3` is a **real outcome, not a failure**: the investigation ran correctly and found
  insufficient evidence. Conflating it with `1` makes the tool unusable in a pipeline.
- Never prompt when `!process.stdin.isTTY` — exit `2` naming the flag that was needed.
- The banner is TTY-only and suppressed under `--quiet`, `--json`, and `NO_COLOR`; never
  on `--version`, which scripts parse.

## Consequences

**Enforced, not encouraged:** `apps/cli/src/presentation/streams.ts` is the only module
permitted to write to stdout or stderr. A guard test fails the build if any other
source file references `console.*`, `process.stdout` or `process.stderr`, making the
contract a build failure rather than a convention people forget under deadline. (The
mechanism is a test rather than the ESLint rule originally planned — see ADR 0012.)

**Follows from this:** the RCA engine emits typed events and never prints. Renderers
subscribe. That seam is what keeps `--json` honest, and it is the entire prerequisite for
adding a terminal UI later (0010).

## Implementation notes (added after building it)

Three things were not obvious from the outside and cost real time to find:

1. **nest-commander applies commander's `exitOverride` to the root command only.**
   A usage error on a subcommand (`heimdall version --nope`) bypasses the configured
   `errorHandler` entirely and commander calls `process.exit(1)` itself. Without
   `ExitCodeContract` walking the command tree at bootstrap, the contract silently
   does not hold for any subcommand — which is where nearly all real usage errors
   occur.

2. **nest-commander overwrites the root `exitOverride` during `run()`** with the
   `errorHandler` passed to `CommandFactory`. So the root path cannot be owned by a
   provider. The entry point builds the app via `createWithoutRunning`, then closes
   its handler over the resolved `ExitCodeContract` before `runApplication`.

3. **commander 8 reports `commander.unknownCommand` for successful per-command help.**
   `heimdall help <command>` and `heimdall <command> --help` both print correct help
   and then raise an error indistinguishable from a genuine typo. The invocation is
   inspected instead of the error. Known deviation: `heimdall help <unknown>` exits 0
   under this rule, having printed root help.

The contract is locked by an end-to-end test that spawns the built binary
(`exit-code.e2e.spec.ts`) rather than by unit tests alone, because every one of these
failures lives in the wiring between commander and nest-commander, not in our code.
