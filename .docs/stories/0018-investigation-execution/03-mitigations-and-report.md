# 0018-03. Mitigations and report

- **Priority:** Medium
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) item 3
- **Decided in:** [ADR 0018](../../adr/0018-investigation-execution-on-the-agent-runtime.md)

## Story

As an engineer with a likely cause in hand, I want concise mitigations from the first manual step
to long-term prevention, each with its trade-offs, so that I can act now and know what to fix
later.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Propose mitigations in three tiers (immediate or manual, short-term, prevention), each with trade-offs | planned |
| 2 | Report the impact tier: what else is hurt, never presented as a cause | planned |
| 3 | Render the report as text, as `--json`, and as the final `--ndjson` event | planned |
| 4 | Link the report to the run's trace id and list the blind spots the conclusion rests on | planned |
| 5 | Specify the report in `.docs/schema/investigation-report.md` | planned |

## Acceptance

- The conclusion validator rejects a `cause-found` conclusion with no mitigation, or with a
  mitigation that has no trade-off: validator spec.
- Golden runs with a real model on `error-burst-30s`, `increased-latency-1` and
  `healthy-baseline` are scored against the checkout README walks; the rubric is shared with
  [0018-04](04-replay-and-golden-evals.md).
- The text renderer writes to stdout only through `Streams`: the stream guard passes.

## Notes

- Runbooks (US-001 item 6) would feed mitigations later; this story only uses the evidence.
