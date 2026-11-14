# 0018-03. Mitigations and report

- **Priority:** Medium
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) item 3
- **Decided in:** [ADR 0018](../../adr/0018-investigation-execution-on-the-agent-runtime.md),
  amendment of 2026-11-01
- **Epic:** [bifrost EP-003](../../../../bifrost/.docs/epics/EP-003-heimdall-investigates-on-demand.md)
- **Specified in:** [investigation-report.md](../../schema/investigation-report.md)

## Story

As an engineer with a likely cause in hand, I want concise mitigations from the first manual step
to long-term prevention, each with its trade-offs, so that I can act now and know what to fix
later.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Propose mitigations in three tiers (immediate or manual, short-term, prevention), each with trade-offs | in progress: each mitigation carries a tier and a non-empty trade-off; a single tier still passes the validator |
| 2 | Report the impact tier: what else is hurt, never presented as a cause | done |
| 3 | Render the report as text, as `--json`, and as the final `--ndjson` event | done: the text is pinned by golden files |
| 4 | Link the report to the run's trace id and list the blind spots the conclusion rests on | done |
| 5 | Specify the report in `.docs/schema/investigation-report.md` | done |
| 6 | Show key figures: baseline to peak, the breach, and a 12-point profile of the window with its shape and state | done |
| 7 | Show a recorded run's report again with `heimdall report`, from its transcript | done |

## Acceptance

- The conclusion validator rejects a `cause-found` conclusion with no mitigation, or with a
  mitigation that has no trade-off: validator spec.
- Golden runs with a real model on `error-burst-30s`, `increased-latency-1` and
  `healthy-baseline` are scored against the checkout README walks; the rubric is shared with
  [0018-04](04-replay-and-golden-evals.md).
- The text renderer writes to stdout only through `Streams`: the stream guard passes.
- The text of every CI transcript's report matches its golden file:
  `investigation-report.renderer.spec.ts`. `heimdall report` prints the same text: report e2e.
- Key figures, blind spots and impact follow their rules on the CI transcripts:
  `report.builder.spec.ts`. Shapes and states follow theirs on synthetic series:
  `profile.summariser.spec.ts`.
- Profiles never reach the model: re-recording added them to each report and left every prompt
  and tool result of the CI transcripts unchanged.

## Notes

- Runbooks (US-001 item 6) would feed mitigations later; this story only uses the evidence.
