# 0002. Blast radius: read-only with a mutation seam

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

An RCA agent pointed at production is only useful if people actually point it at
production. Every capability it holds is a capability an LLM can be argued into using at
3am during an incident, when scrutiny is lowest.

## Options considered

- **Strictly read-only, no seam** — safest, simplest to reason about and to get approved.
  Adding remediation later means retrofitting an approval path through the whole tool
  surface.
- **Read-only now, mutation seam designed in** — tools carry a capability flag; the
  executor has a confirmation hook that is exercised by read-only tools trivially (it
  always passes). No write tool ships.
- **Read plus remediate** — rollback, pod restart, behind confirmation. Requires an
  approval policy, an audit log, and a non-interactive `--yes` contract before it is
  defensible.

## Decision

Read-only tools only. The tool port carries a mutation capability flag and the executor
carries a confirmation hook from day one; no write tool is implemented.

## Consequences

**Easy:** no approval policy needed to ship; pointing Heimdall at production requires no
security review beyond the egress question (0008); the LLM cannot cause an outage.

**Hard:** the seam is untested against a real mutating tool, so the first write tool will
still find gaps in it. That is accepted — a designed-but-unexercised hook is far cheaper
to correct than a retrofit through every call site.

**Watch for:** the confirmation hook silently rotting because nothing exercises it. A
test that registers a fake mutating tool and asserts the hook blocks it keeps the seam
honest without shipping a real write path.
