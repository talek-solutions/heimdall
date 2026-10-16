# 0017. Agent runtime: loop, tools, budgets and tracing

- **Status:** Proposed
- **Date:** 2026-10-16

## Context

The investigation's execution phase is an agent loop: the model picks the next check, reads
the result, and picks again until it can conclude (ADR 0018). ADR 0004's port offers one
`chat` call; nothing turns calls into a loop, runs tools, or decides when the loop ends.
Several constraints apply to any loop Heimdall runs:

- **Read-only** (ADR 0002): a tool carries a mutation flag, and the executor needs a
  confirmation seam before any mutating tool can exist.
- **Nothing leaves without redaction** (ADR 0008): whatever records the loop's progress
  must not become a second path for prompts or telemetry to leave the process.
- **Exit codes are a contract** (ADR 0006): a loop that runs out of budget exits 5, not 1.
- **Replay** (ADR 0007): every turn and tool call has to be capturable as typed data.
- **Caching is a prefix match** (ADR 0004): the tool list must render identically on every
  turn, and history is only ever appended to.

The loop also has to be observable. An engineer whose investigation took four minutes and
forty model calls needs to see where the time and tokens went, in the same tracing backend
they already use.

## Options considered

- **A vendor agent SDK or framework.** Fastest to a working loop. It ties the loop to one
  provider's SDK, hides the turn structure that budgets, replay and tracing need to see, and
  reopens what ADR 0004 closed: the port exists so no provider owns the engine.
- **Tool definitions written per provider in each agent.** Simple for one provider; with two,
  every tool is written twice and the copies drift.
- **Our own runner on the existing port, a provider-neutral tools repository, and one tool
  port per provider.** Chosen. Most of the code is ours, but each part is small and every
  turn is visible to budgets, replay and tracing.

## Decision

A provider-neutral runtime in `libs/agent` (`@heimdall/agent`). It names no domain concept:
investigation is one caller among future ones.

### The loop

`AgentRunner.run` sends the system prompt, the history and the rendered tools, runs every
tool call in the reply, appends the results, and repeats. Every change to history is an
append, so the cached prefix survives each turn.

- **Parallel calls.** All tool calls in one reply run concurrently, up to a concurrency cap.
  Their results go back as one tool turn: splitting them teaches the model to stop calling in
  parallel.
- **The stop tool.** The caller names one tool as the stop tool, e.g. `conclude`. When it
  succeeds, the run ends with that tool's parsed input as its output. When it returns an
  error, the error goes back to the model, which can correct itself; that is where a caller
  validates the final answer.
- **Endings:**

  | The model… | The runner… |
  |---|---|
  | calls tools | runs them and continues |
  | calls the stop tool successfully | ends with its output |
  | stops without a tool call | nudges once to call the stop tool, then ends **inconclusive** |
  | is cut off at the output limit | answers each cut-off call with an error, or nudges for brevity, and continues |
  | pauses (`LLMFinishReason.PAUSED`) | re-sends the turn as is, up to a continuation cap |
  | is stopped by a content filter | ends **inconclusive** |

- **Tool choice is always `auto`.** Current models reject forced tool choice, so the prompt
  and the nudge carry the instruction instead.
- **Reasoning round-trips.** Reasoning parts are echoed back unchanged in later turns, as
  providers require when thinking is on. The port carries their opaque signatures.

### The tools repository

An `IAgentTool` has a name, a description, a JSON Schema for its input, a `ToolAccess` flag, a
`parse` guard and an `execute` function. `ToolRepository.of([...])` rejects duplicate names
and renders tools sorted by name, so the tool list never changes between turns.

- **`parse` validates every input** before `execute` runs. The schema guides the model; the
  guard protects the code. This also covers schema keywords a provider strips.
- **Errors are results, not exceptions.** An unknown tool, an invalid input or a failing tool
  goes back to the model as an error result shaped `{ errorCode, message }`, and counts
  against the budget.
- **Mutating tools are refused** unless the caller passes a confirmation hook. No caller
  passes one yet, so no mutating tool can run (ADR 0002).

### Provider tool ports

`ILLMToolPort` (in `libs/llm`) turns neutral tool specs into what one provider accepts, and
declares that provider's capabilities: strict schemas, parallel calls, forced tool choice and
the name rule. `LlmModule` provides the port for the
configured provider as `LLM_TOOL_PORT`. A new provider adds a port, not new tools.

The Anthropic port:
- enforces `^[a-zA-Z0-9_-]{1,64}$` for tool names
- marks tools `strict`, gives every object `additionalProperties: false` and a `required`
  list, and strips the keywords strict mode does not accept: numeric bounds (`minimum`,
  `maximum`, their `exclusive` forms, `multipleOf`), string lengths (`minLength`, `maxLength`)
  and complex array constraints (`maxItems`, `uniqueItems`, `contains`, `minItems` above 1).
  `parse` still enforces them
- places a cache breakpoint on the system prompt, which caches the tools rendered before it

### Budgets

Every run has limits on turns, tool calls, cumulative input and output tokens, tool cost
units (whatever a tool reports, e.g. backend queries), and wall-clock time.

- **Checked between steps.** Tools receive an abort signal for the time that is left.
- **Warned before the end.** On the last turn the budget allows, the model is told to call the
  stop tool now.
- **Exit 5.** Crossing a limit raises `AGENT_BUDGET_EXCEEDED` with the partial transcript,
  which the CLI maps to exit code 5.
- **Configurable.** Defaults come from the `AGENT_*` variables through the `AGENT_CONFIG`
  provider; a caller can override any of them for one run.

### Events

The runner emits typed events (`AgentEventType`): turn started, model responded, tool
called, tool completed, finished. Callers translate them into their own events. Later they
become the replay transcript (ADR 0007).

### Tracing and metrics

Libraries depend only on `@opentelemetry/api`, which does nothing until an SDK registers.
The CLI registers one, exporting over OTLP/HTTP, only when `OTEL_EXPORTER_OTLP_ENDPOINT` (or a
per-signal OTLP endpoint) is set. Spans follow the OpenTelemetry GenAI conventions:

| Span | Kind | Attributes |
|---|---|---|
| `invoke_agent <name>` | internal | `gen_ai.operation.name`, `gen_ai.agent.name`, `heimdall.agent.outcome`, turns, tool calls |
| `chat <model>` | client | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.model`, `gen_ai.response.finish_reasons`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens` |
| `execute_tool <name>` | internal | `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.type`, `heimdall.tool.status`, `heimdall.tool.cost` |

Metrics:

| Metric | What it measures |
|---|---|
| `gen_ai.client.token.usage` | tokens per model call, by `gen_ai.token.type` (input or output) |
| `gen_ai.client.operation.duration` | seconds per model call |
| `heimdall.agent.tool_calls` | tool calls, by tool and status |
| `heimdall.agent.budget.used` | the fraction of each budget dimension a run used |

The run's trace id is returned with its result, so a report can link to the trace.

### Content policy

Spans, span events and metrics carry ids, names, counts, durations and statuses. They never
carry the system prompt, messages, reasoning, tool inputs, tool outputs or telemetry. Error
messages are reduced to their error code. A trace backend is one more place data goes, and
ADR 0008 applies to it like any other.

## Consequences

**Easy:**
- The loop is testable without a model: a scripted provider replays tool calls and every
  ending is a unit test.
- A second provider adds one port. The tools and the loop are unchanged.
- An investigation's cost and latency are visible per turn and per tool in the engineer's own
  tracing backend, next to the services being investigated.

**Hard:**
- We own the loop's edge cases (pauses, truncation, refusals, reasoning replay) and must keep
  up with provider changes ourselves.
- The OpenTelemetry SDK adds dependencies and startup time to the CLI. Libraries carry only the
  API.
- Without content in spans, a trace shows that a turn was slow, not why the model chose what
  it did. That answer belongs to the replay transcript (ADR 0007), which is kept locally.

**Will regret if:** we need several cooperating agents. That would build on this runner (a tool
that runs a sub-agent), so the regret is in what has to be added, not in what was built.
