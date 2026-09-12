# 0011. CommonJS output and npm workspaces for module resolution

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

Two questions the plan left open, both forced during the first build.

**Module format.** NestJS resolves DI from `reflect-metadata` and legacy decorators.
That path is well-trodden on CommonJS and rough on ESM.

**Cross-package resolution.** The first attempt used TypeScript path aliases
(`@heimdall/core`) with SWC's `jsc.paths`. SWC rewrote the alias to a relative path
computed against the *source* tree, while `--strip-leading-paths` gave the *output* tree
a different depth. The emitted `require` pointed at `libs/core/src` — TypeScript source —
and failed at runtime. Path aliases and a monorepo output layout do not compose here.

## Decision

CommonJS output, and **npm workspaces** instead of path aliases. Each lib and app is a
real package with its own `package.json` and an `exports` map. Resolution happens through
`node_modules` symlinks at runtime, with no build-time rewriting involved.

Each package's `exports` declares `types` pointing at **source** and `default` pointing at
**dist**, so typechecking needs no prior build while runtime uses compiled output.

## Consequences

**This makes the architecture's boundary rule real rather than advisory.** Node's resolver
refuses any subpath a package does not export — verified:

```
require('@heimdall/core/enums/exit-code.enum')
  → ERR_PACKAGE_PATH_NOT_EXPORTED
require('@heimdall/core/dist/index.js')
  → ERR_PACKAGE_PATH_NOT_EXPORTED
```

So `libs/telemetry` exporting only `.` and `./ports` means `rca-engine` importing
`@heimdall/telemetry/adapters` is a hard runtime failure, not a lint warning someone can
disable. The ESLint boundaries rule becomes a faster, friendlier duplicate of a guarantee
the runtime already enforces.

**Costs:** a `package.json` per lib, and every new public subpath must be added to an
`exports` map deliberately — which is the point, but it will feel like friction the first
time someone adds one.

**ESM is not ruled out forever.** If Nest's ESM story settles, revisit — the workspace
layout is unaffected by that choice, so the migration would be confined to the build
config and import extensions.

**Also settled here:** SWC does not pick up the root `.swcrc` when invoked from a
workspace subdirectory; each package's build script passes `--config-file ../../.swcrc`
explicitly. Without it SWC silently emits ESM with decorators stripped, which surfaces as
a confusing `MODULE_NOT_FOUND` rather than a config error.
