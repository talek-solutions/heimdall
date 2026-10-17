# Design notes

How a component works in depth: the rules, formulas and defaults an ADR decides on but does not
spell out, with worked examples. Each rule names the spec that pins it, so a note and its code
cannot drift apart unnoticed. ADRs say why; these notes say exactly what.

| Note | Status | Decided in | Delivered by |
|---|---|---|---|
| [Health evaluation](health-evaluation.md) | Final | [ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md) | [Story 0018-01](../stories/0018-investigation-execution/01-metrics-investigation.md) |
| [Redaction and scrubbers](redaction-and-scrubbers.md) | Final | [ADR 0008](../adr/0008-egress-allowlist-and-scrub.md), [ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md) | [Story 0018-02](../stories/0018-investigation-execution/02-logs-and-traces-evidence.md) |
| [Log and trace evidence](log-and-trace-evidence.md) | Final | [ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md) | [Story 0018-02](../stories/0018-investigation-execution/02-logs-and-traces-evidence.md) |

A note stays **Draft** until its slice ships; then every rule it states is pinned by a spec.
