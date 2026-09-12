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
