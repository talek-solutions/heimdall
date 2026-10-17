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
| 1 | Read logs and traces through the redacting `LogsSource` and `TracesSource`, whose values are a branded `RedactedText` | done |
| 2 | Drop every field the manifest's `telemetry.logs.fields` and the span attribute allowlist do not map; read an unstructured line as its message | done |
| 3 | Scrub allowed fields with one scrubber per `Scrubber` value plus the config's `additionalPatterns`, replacing matches with `[REDACTED:<scrubber>]` | done |
| 4 | Validate `additionalPatterns` at load, including a guard against expensive patterns | done |
| 5 | Compile LogQL and TraceQL from telemetry identities. A step's `match` drops log lines that contradict it, and becomes semantic-convention attributes on the subject's end of the hop | done |
| 6 | Run the planned logs and traces checks, and `search_logs`, `search_traces` and `get_trace` within reach | done |
| 7 | Compare time-sliced samples with the baseline: log templates that are new or surging (with examples), span operations that are new, slower or failing more (with an exemplar trace) | done |
| 8 | Count redaction: `heimdall.redaction.records`, `heimdall.redaction.fields_dropped`, `heimdall.redaction.matches`, a `telemetry.redact` span per batch, and a summary in the report | done |
| 9 | Remove `@heimdall/telemetry/connectors`, closing ADR 0008's amendment | done |
| 10 | Document the stages, every scrubber and the counters in [`.docs/design/redaction-and-scrubbers.md`](../../design/redaction-and-scrubbers.md), and the evidence rules in [`.docs/design/log-and-trace-evidence.md`](../../design/log-and-trace-evidence.md) | done |

## Acceptance

- **Fixture walk.** `increased-latency-1` concludes `orders-reconcile` contention on `orders-pg`
  (origin step 3), citing its logs, within the default query budget (scripted-model e2e).
- **Nothing leaks.** With the secret-bearing fields mapped, the planted JWT, bearer token, AWS key,
  connection string and emails are scrubbed before any request to the model, and each scrubber's
  token is what reaches it. With the reference manifest, the unmapped fields never reach the
  model: redaction e2e. A private key is not planted in the fixtures; its scrubber is pinned by unit
  specs.
- **Per scrubber.** One planted-secret spec per scrubber covers a hit, a documented miss and a
  false-positive check. An expensive or invalid `additionalPatterns` entry fails at load.
- **Counters.** With an in-memory exporter, the redaction counters and span counts equal the
  planted data. No matched value or dropped field name appears in any span or metric. Dropped
  field names appear only in the local report (text and `--json`), never in a model request.
- **Guard.** A spec fails if anything outside `libs/telemetry` imports its connectors or fixtures,
  or if the package exports more than its root.
- **Design docs.** `redaction-and-scrubbers.md` and `log-and-trace-evidence.md` are published, and
  every rule in them names the spec that pins it.

## Notes

- The counters make over-redaction visible (ADR 0008, Hard). Widening the allowlist stays a
  recorded decision, not a config tweak.
