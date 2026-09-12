# 0003. Runtime: pinned Node 24

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

Heimdall is distributed internally only, so the runtime can be pinned rather than
negotiated with unknown consumers. Node 24 is Active LTS (maintained to ~April 2028) and
ships `node:test`, `node --run`, native `fetch`, and experimental TypeScript execution.

## Options considered

- **Node 24, pinned, internal** — one runtime to support, `node:test` replaces a test
  framework, `node --run` replaces npm-script indirection.
- **`>=22`, published to npm** — broad compatibility for outside consumers; requires a
  full build pipeline and possibly dual ESM/CJS output. Solves a distribution problem we
  do not have.
- **Docker image / vendored binary** — total runtime control, heaviest to build and ship.

## Decision

Pin Node 24. Build with SWC (`emitDecoratorMetadata: true`). Tests via `node:test`.

## Consequences — including a correction

Node 24 was initially argued for partly on the grounds that **native TypeScript
type-stripping would delete most of the toolchain. That benefit is not available to this
project**, for two independent reasons:

1. NestJS resolves dependencies from `emitDecoratorMetadata` (`design:paramtypes`). Node's
   native stripping does not emit decorator metadata, so `nest-commander` (0001) cannot
   run under it.
2. Bare `--experimental-strip-types` rejects TypeScript `enum`, which the repository
   conventions mandate. (`--experimental-transform-types` handles enums, but not the
   metadata in point 1.)

This is recorded rather than quietly dropped because the original reasoning was wrong in
a way that would otherwise be re-derived by the next person to read only the conclusion.

**Still earned:** `node:test` removes vitest/jest entirely; `node --run`; native `fetch`
and `AbortSignal`; a single supported runtime.

**Cost:** a compile step remains. SWC over `tsc` for speed, with `tsc --noEmit` as the
type gate in CI.

**Reversal trigger:** if the decorator-metadata constraint disappears (Node emitting it
natively, or Nest moving off it), revisit — the toolchain saving would be real.
