# 0017-01. Tools repository and provider tool ports

- **Priority:** High
- **Persona:** Heimdall developer writing an agent
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) items 1–2, through
  the execution phase
- **Decided in:** [ADR 0017](../../adr/0017-agent-runtime-loop-tools-budgets-tracing.md)

## Story

As a developer writing an agent, I want to define each tool once, provider-neutrally, so that the
same tools run on any LLM provider and each provider's quirks live in one place.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Define a tool as `IAgentTool`: name, description, input schema, `ToolAccess`, `parse` guard, `execute` | done |
| 2 | Collect tools in a `ToolRepository` that rejects duplicate names and renders them sorted by name | done |
| 3 | Render tools for a provider through `ILLMToolPort`, which also declares the provider's capabilities | done |
| 4 | Render tools for Anthropic: name rule, strict schemas with unsupported keywords stripped, cached tools prefix | done |
| 5 | Pick the configured provider's port from `LlmModule` as `LLM_TOOL_PORT` | done |
| 6 | Round-trip reasoning parts and their signatures through the port, so tool loops work with thinking on | done |

## Acceptance

- Duplicate tool names are rejected when the repository is built, and specs are rendered sorted by
  name: `libs/agent` repository spec.
- The Anthropic port rejects a name outside `^[a-zA-Z0-9_-]{1,64}$`. It gives every object
  `additionalProperties: false` and a `required` list, strips numeric bounds, string lengths and
  complex array constraints at every depth, and asks for a system-prompt cache breakpoint:
  `anthropic.tool-port.spec.ts`.
- A thinking block's signature, and a redacted thinking block's data, survive the trip response →
  request unchanged: Anthropic mapper specs.
- `pause_turn` maps to `LLMFinishReason.PAUSED`: response mapper spec.

## Notes

- Strict mode is set by the port, not by each tool. A tool's `parse` guard still enforces every
  constraint the port strips.
- A call-normalising hook on the port was considered and left out: no provider needs one yet.
