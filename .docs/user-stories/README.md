# User stories

What Heimdall is for, from the point of view of the people who use it. One story per file,
numbered. Stories change as understanding improves; unlike ADRs they are edited in place, and
each item carries its own status so progress stays visible without a separate tracker.

A story says **what** and **why**. **How** lives in the ADRs each item links to.

## Template

```markdown
# US-NNN. Short title

- **Priority:** High | Medium | Low
- **Persona:** who asks for it

## Story
As a …, I want … so that …

## Items
| # | The user can… | Status | Where |
|---|---|---|---|

## Notes
Scope decisions, open questions.
```

## Status

| Status | Meaning |
|---|---|
| `done` | Shipped and covered by tests |
| `in progress` | Being built now |
| `planned` | Designed, with an ADR, not yet built |
| `seam` | An extension point is designed in; the capability itself is not planned yet |
| `not started` | Neither designed nor built |

## Index

| # | Title | Priority | Persona |
|---|---|---|---|
| [US-001](US-001-on-demand-investigation.md) | On-demand investigation | High | Software engineer |
| [US-002](US-002-incident-notifications.md) | Incident notifications with pre-analysis | Low | SRE responder |
