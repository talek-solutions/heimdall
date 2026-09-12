# 0008. Egress: allowlist plus scrubbing

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

Heimdall's core function is to take production logs and traces and send them to a
third-party inference API. Production logs contain bearer tokens, connection strings, PEM
blocks, and personal data. This is the single highest-consequence decision in the project
and the one most likely to be waved through.

## Options considered

- **Pattern-based scrubbing alone** — send everything, run detectors first. Preserves
  context the model might need. A missed pattern is a silent leak, and detector coverage
  is never complete against fields nobody anticipated.
- **Deny-by-default allowlist alone** — only mapped fields are sent. Safe against unknown
  fields, but an allowed `message` body can still carry an embedded token.
- **Allowlist plus scrubbing on allowed fields** — both failure modes covered.
- **No redaction** — defensible only with a written sign-off naming who accepted it.

## Decision

Deny-by-default allowlist keyed on the config's field mapping (0005), **and**
pattern-scrubbing applied to the fields that pass it.

## Consequences

**Safe by construction against the common case:** a newly-added log field cannot leak,
because leaking requires someone to have explicitly mapped it. The second pass catches
secrets embedded inside a field that is legitimately allowed.

**Structurally enforced:** the telemetry port returns `TelemetryRecord`, a type that only
exists post-redaction. The raw HTTP clients live inside `telemetry/adapters/` and are not
exported from the library index, so the engine has no way to obtain unredacted data. This
must stay true — an "escape hatch for debugging" would silently void the entire control.

**Hard:** over-redaction degrades RCA quality, and the failure is quiet — the model simply
reasons worse with less context. Expect to tune the allowlist per deployment, and treat a
widening request as a decision worth recording, not a config tweak.

**Still open:** who signs this off. The control is technical; the acceptance is not.

## Implementation note: the config file cannot hold a secret

The allowlist and scrubbers guard data leaving *at query time*. A second leak path
exists upstream and is easier to miss: someone pasting a token into the config file,
which is then committed.

The schema makes that structurally impossible. Backend auth is expressed only as the
NAME of an environment variable to read at runtime, validated against
`/^[A-Z][A-Z0-9_]*$/`:

```yaml
auth:
  scheme: bearer
  tokenEnv: LOKI_TOKEN      # accepted — a name
  # tokenEnv: eyJhbGciOi... # rejected at load with CONFIG_INVALID
```

There is no field anywhere in the schema that accepts a credential value, so the
mistake cannot be made rather than being caught by review.
