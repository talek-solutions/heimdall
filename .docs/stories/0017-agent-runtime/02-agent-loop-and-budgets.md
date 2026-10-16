# 0017-02. Agent loop and budgets

- **Priority:** High
- **Persona:** Software engineer running an investigation
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) items 1 and 7
- **Decided in:** [ADR 0017](../../adr/0017-agent-runtime-loop-tools-budgets-tracing.md)

## Story

As an engineer running an investigation, I want the agent to stop by itself, within limits I can
set, so that a run never hangs, never spends without bound, and fails in a way a pipeline can
recognise.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Run a loop over `ILLMProvider.chat`: tool calls in parallel up to a cap, all results in one turn | done |
| 2 | End on a caller-chosen stop tool; an error from the stop tool goes back to the model to correct | done |
| 3 | Return unknown tools, invalid inputs and failing tools to the model as `{ errorCode, message }` results | done |
| 4 | Refuse mutating tools unless a confirmation hook is given (ADR 0002) | done |
| 5 | Nudge once when the model stops without a tool call, then end inconclusive | done |
| 6 | Recover from an output-limit cut-off, resume a paused turn up to a cap, end inconclusive on a refusal | done |
| 7 | Enforce budgets on turns, tool calls, input and output tokens, tool cost and time; warn on the last turn | done |
| 8 | Raise `AGENT_BUDGET_EXCEEDED` with the partial transcript; the CLI exits 5 | done |
| 9 | Emit typed `AgentEventType` events for every turn, model response and tool call | done |
| 10 | Take budget defaults from `AGENT_*` variables through the `AGENT_CONFIG` provider | done |

## Acceptance

- Runner specs with a scripted `ILLMProvider` cover each ending (`agent.runner.spec.ts`):
  - the stop tool, including a corrected second attempt
  - parallel calls answered in one tool turn
  - an invalid input returned as an error result
  - an unknown tool
  - a refused mutating tool
  - the nudge, then inconclusive
  - a cut-off reply
  - a paused turn
  - each budget dimension
- The history the runner sends only ever grows by appending: runner spec.
- `AGENT_BUDGET_EXCEEDED` maps to exit code 5: `error-exit.mapper.spec.ts`.
- An unusable `AGENT_*` value fails at startup with `AGENT_INVALID_CONFIG`: config resolver spec.

## Notes

- Tool choice stays `auto`: current models reject forced tool choice, so the nudge is a prompt.
- Time is checked between steps; each tool also receives an abort signal for the time that is left.
