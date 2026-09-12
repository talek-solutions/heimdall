# 0010. No terminal UI in scope

- **Status:** Accepted
- **Date:** 2026-09-12

## Context

A Claude Code-style terminal UI was considered — Ink (React plus Yoga flexbox rendering
to the terminal). It would suit the product: a live investigation with streaming
hypotheses, tool calls, and evidence is exactly what a rich TUI is good at.

It is also a workstream roughly the size of the RCA engine itself.

## Decision

Out of scope. Output is human-readable streaming text to stderr, plus `--json` and
`--ndjson` (0006).

## Consequences

**Nothing is forfeited by deferring.** The engine emits a typed event stream and never
prints; renderers subscribe. A TUI is one more renderer over events that already exist,
requiring no change to the domain. That seam costs nothing to build now — it is simply
"the domain does not call `console.log`" — and it is the whole prerequisite.

**If it is picked up later**, two decisions are already made:
- **Inline rendering, never the alternate screen buffer.** Alt-screen destroys scrollback,
  and re-reading evidence by scrolling back is central to how this tool gets used.
- **A REPL is where approval gates belong.** If Heimdall ever proposes a remediation
  (0002), the confirmation UI needs a home, and a watch-only renderer does not have one.
