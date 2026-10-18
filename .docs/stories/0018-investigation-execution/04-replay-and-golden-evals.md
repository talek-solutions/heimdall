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
| 1 | Persist every run's transcript (model calls, redacted source calls, pins, events, report) locally in `~/.heimdall/runs`, owner-only, keeping the last 20 | done |
| 2 | Replay a transcript with `heimdall replay`, answered by the `TranscriptSession` behind the ports' interceptor hooks, with no network; report where today's code makes the run differ, exit 6 on a divergence | done |
| 3 | Score golden incidents: code checks the outcome, origin and cause; a judge scores right component, right mechanism and evidence that supports the conclusion, 0 to 2 each with a reason | done |
| 4 | Run the golden set on demand with `heimdall eval`, never in CI, since it spends real tokens; each case runs as `investigate` does and is recorded | done |
| 5 | Calibrate the judge against hand-scored runs, and mark its scores uncalibrated until a passing lock matches the judge model | in progress: the gate is built; the hand-scored set needs real runs scored by a person |

## Acceptance

- The committed scripted-model transcripts of `error-burst-30s`, `increased-latency-1` and
  `healthy-baseline` replay byte for byte with no network: replay spec. They are re-recorded for
  free with `npm run transcripts:record`.
- A changed prompt is reported but does not fail a replay unless `--strict`; a changed tool
  result, source call or report fails it.
- The judge is calibrated on a small hand-scored set before its scores are trusted (ADR 0007):
  `heimdall eval --calibrate` needs at least 5 hand-scored sheets, and passes when every
  dimension agrees exactly on 80% or more and is never off by 2. Until then every scorecard says
  **uncalibrated**: calibrator spec, eval e2e.
- `heimdall eval` runs without tokens in specs (a scripted judge, a stand-in child process) and
  reports a run that ended in error without asking the judge: eval service spec, eval e2e.

## Notes

- Replay tells whether and where a change alters a run, not whether conclusions got better; that
  is the golden set's question (ADR 0007, amendment).
- The traces of [0017-03](../0017-agent-runtime/03-agent-observability-and-tracing.md) carry no
  content, so they cannot be replayed; the transcript is recorded at the ports instead.
- The rules are in [`.docs/design/replay-and-evals.md`](../../design/replay-and-evals.md).
