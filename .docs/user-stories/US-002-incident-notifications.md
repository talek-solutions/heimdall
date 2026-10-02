# US-002. Incident notifications with pre-analysis

- **Priority:** Low
- **Persona:** SRE responder

## Story

As an SRE responder, I want timely notifications about production disruptions and behaviour
that is out of the ordinary, so that I start from evidence rather than from an alert name.

## Items

| # | The user can… | Status | Where |
|---|---|---|---|
| 1 | Receive updates at different severity levels | not started | |
| 2 | Receive notifications that already carry pre-analysis, related evidence and checked correlations | not started | Would reuse the init phase of [US-001](US-001-on-demand-investigation.md): an alert's labels locate the entry exactly, with no model call ([0015](../adr/0015-system-manifest-as-a-traversable-graph.md)) |
| 3 | Request a full on-demand investigation from a notification | not started | [US-001](US-001-on-demand-investigation.md) |
| 4 | Follow the autonomous investigation live on a console page linked from the notification | not started | Would subscribe to the same typed events the CLI renders ([0006](../adr/0006-cli-output-contract.md)) |

## Notes

Needs a long-running service, which Heimdall does not have yet; out of scope for the MVP.
