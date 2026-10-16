# Delivery stories

How the product stories in [`.docs/user-stories`](../user-stories/README.md) are delivered, one
slice at a time. A folder holds the stories of one decision (`NNNN-<adr-slug>/`) or of one
component (`<component>/`); a story inside it is numbered within the folder.

A product story (`US-NNN`) says what a user needs. A delivery story says what one slice makes
true, how that is checked, and which ADR explains the how. Each delivery story links up to the
US-001 item, or other product item, it advances. Like product stories, they are edited in place
and every item carries its own status.

## Template

```markdown
# NNNN-NN. Short title

- **Priority:** High | Medium | Low
- **Persona:** who benefits
- **Advances:** [US-NNN](…) item N
- **Decided in:** [ADR NNNN](…)

## Story
As a …, I want … so that …

## Items
| # | It can… | Status |
|---|---|---|

## Acceptance
- Checkable statements, each naming the test or command that proves it.

## Notes
Scope decisions, open questions.
```

Statuses are those of the product stories: `done`, `in progress`, `planned`, `seam`,
`not started` ([meanings](../user-stories/README.md#status)).

## Index

### [0017 — Agent runtime](0017-agent-runtime/)

| # | Title | Status |
|---|---|---|
| [0017-01](0017-agent-runtime/01-tools-repository-and-provider-ports.md) | Tools repository and provider tool ports | done |
| [0017-02](0017-agent-runtime/02-agent-loop-and-budgets.md) | Agent loop and budgets | done |
| [0017-03](0017-agent-runtime/03-agent-observability-and-tracing.md) | Agent observability and tracing | done |

### [0018 — Investigation execution](0018-investigation-execution/)

| # | Title | Status |
|---|---|---|
| [0018-01](0018-investigation-execution/01-metrics-investigation.md) | Metrics investigation | planned |
| [0018-02](0018-investigation-execution/02-logs-and-traces-evidence.md) | Logs and traces evidence, with redaction | planned |
| [0018-03](0018-investigation-execution/03-mitigations-and-report.md) | Mitigations and report | planned |
| [0018-04](0018-investigation-execution/04-replay-and-golden-evals.md) | Replay and golden evaluations | planned |
