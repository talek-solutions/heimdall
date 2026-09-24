export const DEFAULT_CONFIG_YAML = `# Heimdall configuration.
#
# Register telemetry sources once by alias, then group them into contexts.
# currentContext selects the active context; override it per run with the
# HEIMDALL_CONTEXT environment variable or the --context flag.
#
# Credentials never live in this file: auth names the environment variable
# that holds the secret (tokenEnv: LOKI_TOKEN), never the secret itself.
version: 1
kind: Config

currentContext: null

# sources:
#   - alias: prod-loki
#     type: loki                   # loki | prometheus | tempo | grafana
#     url: https://loki.example.com
#     auth:
#       scheme: bearer             # none | bearer | basic
#       tokenEnv: LOKI_TOKEN
#     metadata:
#       description: Production logs
#       labels: { env: prod }
#       annotations: { owner: sre@example.com }
#   - alias: prod-grafana
#     type: grafana                # queried through Grafana's datasource proxy
#     url: https://grafana.example.com
#     datasourceUid: P8E80F9AEF21F6940
#     signal: traces               # logs | metrics | traces
#     auth:
#       scheme: bearer
#       tokenEnv: GRAFANA_TOKEN
sources: []

# contexts:
#   - name: prod
#     sources: [prod-loki, prod-grafana]
#     metadata:
#       labels: { env: prod }
contexts: []

# Preferences, overridden by environment variables and flags.
# defaults:
#   output: text                   # text | json | ndjson
#   logLevel: info

# Every scrubber is enabled when this block is omitted; opting out must be deliberate.
# redaction:
#   scrubbers: [jwt, awsAccessKey, connectionString, privateKey, email, bearerToken]
#   additionalPatterns:
#     - name: internal-api-key
#       pattern: 'ik_[a-zA-Z0-9]{32}'
`;
