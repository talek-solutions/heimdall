# 0007. Eval strategy: replay plus a judged golden set

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

The output of an RCA agent is non-deterministic prose-plus-structure. Without a measure of
quality, every prompt change is unfalsifiable: it either "seems better" or it does not,
and regressions ship silently.

Two different problems hide here. Testing the *plumbing* (tools, parsing, redaction,
output contract) needs determinism. Testing the *answer* needs judgement.

## Decision

Two layers.

1. **Record/replay.** Every run persists a transcript: incident input, every tool call
   with its raw result, the message history, the final verdict. `ReplayLlmClient` and
   `ReplayTelemetrySource` implement the real ports from that fixture, so plumbing tests
   are fully deterministic with no mocking framework.
2. **Golden set scored by LLM-as-judge on a rubric.** Known incidents with written
   reference answers. A judge model scores named dimensions — correct component, correct
   mechanism, evidence actually supports the conclusion — rather than a single boolean.

## Options considered

- **Structured field match only** — cheap, deterministic, runs in CI. Blind to "right
  answer, wrong reasoning", which is the characteristic failure of an RCA agent and
  precisely the thing that erodes trust.
- **Human rubric** — highest fidelity, does not run in CI, will not happen on a busy week.
- **Judge on a rubric** — catches faulty reasoning; costs a model call per case and the
  judge itself needs calibrating against human scores before it can be trusted.

## Consequences

**Easy:** prompt changes become measurable; a regression in reasoning quality is visible
before it reaches an incident.

**Hard:** the judge is itself a model and can be wrong. It must be calibrated against
human-scored cases at least once, and re-checked when the judge model changes. An
uncalibrated judge is a comfort blanket that reads like a signal — worse than no eval,
because it is trusted.

**Cost:** a full judged run spends real money. Gate it behind an explicit command
(`heimdall eval`) rather than every commit; deterministic replay tests carry CI.

## Amendment (2026-10-18): what replay tells, and how it is built

**Replay tells whether and where a change alters a run, not whether it made conclusions
better.** The recorded model answered the old prompt and the old tool results, so replaying its
answers can only show that what the model sees, or what the tools return, has changed, and
where. Better or worse is the golden set's question. The two layers above stay; this sharpens
what the first one is for.

- **Every run is recorded.** `heimdall investigate` writes a transcript to `~/.heimdall/runs/`,
  keeping the last 20, readable by the owner only. `--no-record` or `HEIMDALL_RECORD=off` opts
  out. Recording sits at the ports, around the LLM provider and the redacting telemetry sources,
  so a transcript holds only redacted telemetry (ADR 0008) and allowlisted variables, never a key
  or a token.
- **One session instead of two replay clients.** The `ReplayLlmClient` and
  `ReplayTelemetrySource` of the decision are a single `TranscriptSession`. It sits behind
  optional interceptor hooks of the real ports (`LLM_CALL_INTERCEPTOR`,
  `TELEMETRY_SOURCE_INTERCEPTOR`), so neither port needs a second implementation.
- **`heimdall replay <transcript>`** re-runs `investigate` in a child process. The child gets the
  recorded variables, flags and manifest, since configuration is resolved at bootstrap. It pins
  what came from outside the code: the clock, the resolved sources, an answer typed at a prompt.
  The model and the sources are answered from the transcript. Replay fails on a changed tool
  result, source call or report. A changed prompt or tool schema is reported, and fails only
  under `--strict`. Divergence exits `6` (ADR 0006, amendment).
- **CI replays transcripts recorded by the scripted model.** They can be re-recorded for free
  with `npm run transcripts:record`. Real-model transcripts stay local.
- **`heimdall eval`** runs each golden case (`libs/evals/golden/*.yaml`) as `heimdall investigate`
  in its own process, so the fixture's bootstrap-once model holds (ADR 0014):
  - **Checks:** code checks the outcome, origin and cause.
  - **Judge:** an agent run whose only tool is a strict `score` tool scores component, mechanism
    and evidence, 0 to 2 each with a reason.
- **Calibration has a rule and a lock.** At least 5 hand-scored runs are needed. Every dimension
  must agree exactly on 80% or more and never be off by 2. A passing lock counts only for the
  judge model it was made with. Until one matches, every scorecard says **uncalibrated**.

The rules are in [`.docs/design/replay-and-evals.md`](../design/replay-and-evals.md).
