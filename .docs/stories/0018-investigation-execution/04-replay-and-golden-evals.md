# 0018-04. Replay and golden evaluations

- **Priority:** Medium
- **Persona:** Heimdall developer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) items 1–3, as
  quality assurance
- **Decided in:** [ADR 0007](../../adr/0007-record-replay-and-golden-evals.md),
  [ADR 0018](../../adr/0018-investigation-execution-on-the-agent-runtime.md)

## Story

As a developer changing a prompt, a tool or a threshold, I want to replay recorded investigations
and score known incidents, so that I know whether the change made conclusions better or worse.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Persist a run's transcript from the agent events and tool results, locally and redacted | planned |
| 2 | Replay a transcript through `ReplayLlmProvider` and `ReplayTelemetrySource`, with no network | planned |
| 3 | Score golden incidents with a judge rubric: right component, right mechanism, evidence that supports the conclusion | planned |
| 4 | Run the golden set on demand, never by default in CI, since it spends real tokens | planned |

## Acceptance

- A recorded `error-burst-30s` run replays byte for byte with no network: replay spec.
- The judge is calibrated on a small hand-scored set before its scores are trusted (ADR 0007).

## Notes

- The transcript reuses the typed events of [0017-02](../0017-agent-runtime/02-agent-loop-and-budgets.md);
  the traces of [0017-03](../0017-agent-runtime/03-agent-observability-and-tracing.md) carry no
  content, so they cannot be replayed.
