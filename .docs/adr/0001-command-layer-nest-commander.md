# 0001. Command layer: nest-commander

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

Heimdall is adapter-heavy by nature: every observability backend, the LLM client, the
transcript store, and the redaction pipeline are all swappable implementations behind
ports. Something has to wire them. The repository conventions (`CLAUDE.md`) mandate an
apps/libs split and module-level custom providers for configuration rather than config
service lookups scattered through the code.

## Options considered

- **`nest-commander`** — NestJS DI on top of `commander`. Gives the module/provider model
  the conventions already require, and makes the `libs/` domain reusable by a future HTTP
  service without change. Costs ~200-400ms of bootstrap and a `reflect-metadata`
  dependency, and forces a decorator-metadata-capable build (see 0003).
- **Plain `commander` / `citty`** — minimal, fast startup, no container. Every adapter
  gets wired by hand, and the project diverges from the conventions used elsewhere in the
  organisation.
- **`oclif`** — plugin system, generated docs, built-in update channel. Heaviest option
  and strongly opinionated about layout; the plugin system solves a problem we do not have.

## Decision

`nest-commander`.

## Consequences

**Easy:** port/adapter binding is one line in a module; `replay` swaps real adapters for
fixture-backed ones by changing a composition root rather than the engine (see 0004);
config arrives as injected providers, satisfying the conventions directly.

**Hard:** bootstrap latency is now on the critical path of every invocation. Irrelevant
for a command whose main operation is a multi-second agent loop, and unacceptable if
Heimdall ever needs a sub-100ms subcommand — if that requirement appears, that subcommand
should bypass the Nest bootstrap rather than this decision being reversed wholesale.

**Constrains:** the build must emit decorator metadata, which removes Node's native
type-stripping from the table. Recorded in 0003.
