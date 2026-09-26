# 0013. User-level, kubeconfig-style configuration

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

The first config was a per-project `./heimdall.yaml` holding backends, queries, redaction
and defaults together. Backends and their credentials describe *the user's environment*,
not a project, so every project repeated them; switching between prod and staging meant
editing files or juggling `-c` paths. A `create-config` command was started to generate
these files, which only multiplied the copies.

## Options considered

- **Keep per-project files, add a generator** — repeats endpoints and auth in every
  project; no notion of switching environments.
- **One user-level file, kubeconfig-style** — sources registered once by alias, grouped
  into named contexts, `currentContext` selects one. Familiar to anyone who has used
  `kubectl`. Costs a side effect: the file lives outside the repo and is created on first
  run.
- **Layered user + project files merged at load** — most flexible, but merge semantics
  (which list wins, can a project remove a source?) are a design problem of their own.

## Decision

A single `~/.heimdall/config.yaml` (macOS only for now), overridable with
`HEIMDALL_CONFIG` the way `KUBECONFIG` is:

- `sources[]` — Loki, Prometheus, Tempo, or Grafana (as a datasource proxy, declaring
  `datasourceUid` and `signal`), each with an `alias`, auth by env var NAME (0008) and
  `metadata` (description, labels, annotations).
- `contexts[]` — a name, the aliases it groups, and `metadata`.
- `currentContext` — overridden per run by `HEIMDALL_CONTEXT`, then `--context`.
- `defaults` and `redaction` — unchanged in meaning.

Queries (0005) are **not** in this file; they move to a separate config that references
source aliases, delivered separately.

It lives in its own lib, `@heimdall/config`, which owns the domain enums its schema
validates (`TelemetryBackend`, `SignalType`, `AuthScheme`, `Scrubber`, `FieldSemantic`) and
depends on no other domain lib. `@heimdall/telemetry` depends on config, never the reverse
(see the amendment below). The file is loaded once at bootstrap by
`HeimdallConfigModule` and injected as
`HEIMDALL_CONFIG`. If it is missing at the default location, a commented default is
written (directory `0700`, file `0600`, exclusive create so it is never overwritten). A
missing file at a user-supplied `HEIMDALL_CONFIG` path is an error, not a place to create
one. The `-c` flag and `create-config` command are removed.

## Consequences

**Easy:** register a backend once and use it everywhere; switch environments with one
variable; services receive plain validated data and never touch the filesystem.

**Hard:** loading at bootstrap is fail-fast — an invalid config fails every command,
including `version` and `--help`, as `kubectl` does with a broken kubeconfig. The failure
is still a coded `CONFIG_*` error with exit code 2 (0006), and honours `--json` even though
no command ran. Any first invocation writes to the user's home directory; specs pin `HOME`
to a temporary directory.

**Will regret if:** Heimdall runs in CI or on Linux/Windows hosts — the path is
`os.homedir()`-based with no XDG or Windows handling, and CI would want the file supplied
explicitly via `HEIMDALL_CONFIG`.

## Amendment (2026-09-25): dependency direction flipped

The first cut had `@heimdall/config` depend on `@heimdall/telemetry` for the enums above.
That put the config lib *downstream* of the thing it configures: telemetry connectors could
not take a slice of `ISourceConfig` without a cycle, and had to re-declare an equivalent
shape kept in sync by convention. The enums moved into `@heimdall/config`; telemetry now
imports them and reads only `Pick<ISourceConfig, 'url' | 'timeoutMs' | 'auth'>`. Config
stays a leaf over `@heimdall/core`, so any lib may depend on it.
