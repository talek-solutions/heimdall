# 0004. LLM port with a single Anthropic adapter

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

The original brief asked for a library porting many LLM APIs. The tension: an RCA loop
resends a growing telemetry transcript on every turn, so prompt caching is the dominant
cost lever (~90% cheaper on cached tokens). Caching is a *prefix match* — it requires a
frozen system prompt and a deterministic tool ordering. Adaptive thinking, effort control,
`pause_turn` resumption, and structured final output are similarly provider-specific.

## Options considered

- **Lowest-common-denominator chat interface** — genuinely portable, cheapest to build.
  Cannot express prompt caching, thinking, or effort, so the agent becomes both weaker and
  several times more expensive per investigation. The portability is bought with the exact
  features that make the product work.
- **Capability-negotiated port, many adapters** — honest about provider differences, but
  it is a full-time project. LangChain, the Vercel AI SDK, and LiteLLM each have teams on
  this problem.
- **Wrap an existing router** — fastest to value; inherits someone else's abstraction
  choices and release cadence on the most cost-sensitive path in the system.
- **Interface now, one adapter** — the seam exists, the second implementation does not.

## Decision

Define the port and a capabilities descriptor now. Ship exactly one adapter (Anthropic,
`claude-opus-5`). The interface is shaped around what a competent agent loop needs —
cache control, effort, a tool loop handling `pause_turn`, structured output — and is
explicitly **not** levelled down to a common denominator. A future adapter declares what
it cannot do via capabilities, and the engine degrades explicitly.

## Consequences

**Easy:** full provider fidelity today; the domain never imports a vendor SDK, so the
blast radius of a provider change is `adapters/anthropic/`.

**Hard:** the port costs mapper code, and there is a standing risk the domain model drifts
into being a worse copy of the SDK's types. Guard: the mappers are the only files allowed
to reference SDK types, and the domain model is only extended when the *engine* needs
something, never to mirror the SDK.

**The real payoff is not provider portability.** It is that `transcript/replay` implements
the same port from a fixture, giving deterministic tests with no mocking framework. If
this decision is ever challenged as over-engineering, that is the argument.
