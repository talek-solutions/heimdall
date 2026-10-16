# 0018-02. Logs and traces evidence, with redaction

- **Priority:** High
- **Persona:** Software engineer, and whoever signs off on what leaves for the model
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) items 2, 4 and 8
- **Decided in:** [ADR 0018](../../adr/0018-investigation-execution-on-the-agent-runtime.md),
  [ADR 0008](../../adr/0008-egress-allowlist-and-scrub.md)

## Story

As an engineer, I want the investigation to back its explanation with real log lines and error
spans, and as the person accountable for egress, I want proof that nothing unmapped or secret
went with them.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Read logs and traces through the redacting `TelemetrySource`, returning only `TelemetryRecord`s | planned |
| 2 | Drop every field the manifest's `telemetry.logs.fields` and the span attribute allowlist do not map | planned |
| 3 | Scrub allowed fields with one scrubber per `Scrubber` value plus the config's `additionalPatterns`, replacing matches with `[REDACTED:<scrubber>]` | planned |
| 4 | Validate `additionalPatterns` at load, including a guard against expensive patterns | planned |
| 5 | Compile LogQL and TraceQL from telemetry identities; a step's `match` becomes line filters and semconv attributes | planned |
| 6 | Run the planned logs and traces checks, and `search_logs` and `search_traces` within reach | planned |
| 7 | Cap and deduplicate log samples by template; summarise traces as error spans | planned |
| 8 | Count redaction: `heimdall.redaction.records`, `heimdall.redaction.fields_dropped`, `heimdall.redaction.matches`, a `telemetry.redact` span per batch, and a summary in the report | planned |
| 9 | Narrow `@heimdall/telemetry/connectors` to types, closing ADR 0008's amendment | planned |
| 10 | Document the stages, every scrubber and the counters in [`.docs/design/redaction-and-scrubbers.md`](../../design/redaction-and-scrubbers.md) | planned |

## Acceptance

- **Fixture walk.** `increased-latency-1` concludes `orders-reconcile` contention on `orders-pg`,
  citing its logs (scripted-model e2e).
- **Nothing leaks.** A planted JWT, bearer token, AWS key, connection string, private key, email
  and an unmapped field never appear in any request sent to the model: redaction e2e.
- **Per scrubber.** One planted-secret spec per scrubber covers a hit, a documented miss and a
  false-positive check. An expensive or invalid `additionalPatterns` entry fails at load.
- **Counters.** With an in-memory exporter, the redaction counters and span counts equal the
  planted data, and no matched value or dropped field name appears in any span, metric or report.
- **Guard.** A spec fails if `libs/agent` or `libs/investigation` imports
  `@heimdall/telemetry/connectors`.
- **Redaction doc.** `redaction-and-scrubbers.md` is published, with the spec that pins each rule.

## Notes

- The counters make over-redaction visible (ADR 0008, Hard). Widening the allowlist stays a
  recorded decision, not a config tweak.
