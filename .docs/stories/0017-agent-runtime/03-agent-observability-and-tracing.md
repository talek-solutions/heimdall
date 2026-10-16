# 0017-03. Agent observability and tracing

- **Priority:** High
- **Persona:** Software engineer, and the platform team running Heimdall
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) items 2 and 8
- **Decided in:** [ADR 0017](../../adr/0017-agent-runtime-loop-tools-budgets-tracing.md)

## Story

As an engineer, I want every agent run traced in my own tracing backend, so that I can see where
an investigation spent its time and tokens without anything sensitive leaving with the trace.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Record `invoke_agent`, `chat` and `execute_tool` spans with GenAI semantic-convention attributes | done |
| 2 | Record token usage, model-call duration, tool calls and budget use as metrics | done |
| 3 | Keep prompts, messages, reasoning, tool inputs and outputs, and telemetry out of every span, event and metric | done |
| 4 | Return the run's trace id with its result | done |
| 5 | Export over OTLP/HTTP from the CLI only when an OTLP endpoint is configured, and do nothing otherwise | done |
| 6 | Flush traces and metrics before the CLI exits, with diagnostics on stderr only | done |

## Acceptance

- With an in-memory exporter, one run produces the span tree `invoke_agent` → `chat` and
  `execute_tool`, with the documented attributes: `agent.tracing.spec.ts`.
- No span attribute, event or metric attribute contains the system prompt, a message, a tool input
  or a tool output: the same spec plants marker strings in each and searches every export for them.
- Token usage and tool-call metrics carry the expected values: `agent.tracing.spec.ts`.
- Without `OTEL_EXPORTER_OTLP_ENDPOINT`, the CLI registers no SDK and its output is unchanged:
  `tracing.spec.ts` in `apps/cli`.
- The stream guard still passes: no observability code writes to stdout.

## Notes

- Libraries depend only on `@opentelemetry/api`. The SDK and exporters live in the CLI, pinned to
  exact versions.
- The redaction counters of [0018-02](../0018-investigation-execution/02-logs-and-traces-evidence.md)
  and the `telemetry.query` spans of
  [0018-01](../0018-investigation-execution/01-metrics-investigation.md) use the same setup.
