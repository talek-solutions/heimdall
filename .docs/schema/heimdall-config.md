# `~/.heimdall/config.yaml`

User-level Heimdall configuration, modelled on kubeconfig. Implemented in `libs/config`
(`@heimdall/config`). See
[ADR 0013](../adr/0013-user-level-kubeconfig-style-config.md) for the reasoning.

## Location

| Source | Path |
|---|---|
| `HEIMDALL_CONFIG` (if set and non-empty) | that path, resolved to absolute; must exist |
| default | `~/.heimdall/config.yaml`; created on first run if missing |

## Example

```yaml
version: 1                      # required; only 1 exists
kind: Config                    # required
currentContext: prod            # null or a declared context name

sources:
  - alias: prod-loki            # lowercase letters, digits, dashes
    type: loki                  # loki | prometheus | tempo | grafana
    url: https://loki.example.com
    auth:                       # default { scheme: none }
      scheme: bearer            # none | bearer | basic
      tokenEnv: LOKI_TOKEN      # env var NAME, never the secret (ADR 0008)
    timeoutMs: 30000            # default 30000, max 120000
    metadata:
      description: Production logs
      labels: { env: prod, example.com/team: payments }
      annotations: { owner: sre@example.com }

  - alias: prod-grafana
    type: grafana               # queried through Grafana's datasource proxy
    url: https://grafana.example.com
    datasourceUid: P8E80F9AEF21F6940   # required for grafana
    signal: traces                     # required for grafana: logs | metrics | traces
    auth: { scheme: bearer, tokenEnv: GRAFANA_TOKEN }

contexts:
  - name: prod
    sources: [prod-loki, prod-grafana]   # at least one; each must be a declared alias
    metadata: { labels: { env: prod } }

defaults:                       # optional; flag > env > this > built-in
  output: text                  # text | json | ndjson
  logLevel: info

redaction:                      # optional; all scrubbers on when omitted
  scrubbers: [jwt, awsAccessKey, connectionString, privateKey, email, bearerToken]
  additionalPatterns:
    - { name: internal-api-key, pattern: 'ik_[a-zA-Z0-9]{32}' }
```

## Active context

Selected by `--context` > `HEIMDALL_CONTEXT` > `currentContext`. None selected is valid.

## Validation rules

- Unknown keys are rejected at every level.
- Source aliases and context names are unique.
- Every alias a context lists is declared, and listed at most once.
- `currentContext`, when set, names a declared context.
- Label keys follow Kubernetes syntax (`env`, `example.com/team`).

## Error codes

All exit with code 2 (ADR 0006) and the `{ errorCode, message? }` shape.

| Code | When |
|---|---|
| `CONFIG_FILE_NOT_FOUND` | `HEIMDALL_CONFIG` points at a missing file |
| `CONFIG_FILE_UNREADABLE` | the file exists but cannot be read |
| `CONFIG_WRITE_FAILED` | the default file could not be created |
| `CONFIG_PARSE_FAILED` | malformed YAML |
| `CONFIG_UNSUPPORTED_VERSION` | `version` other than 1 |
| `CONFIG_INVALID` | schema or cross-reference violation |
| `CONFIG_CONTEXT_NOT_FOUND` | `--context` / `HEIMDALL_CONTEXT` names an undeclared context |
