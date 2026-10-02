# US-001. On-demand investigation

- **Priority:** High
- **Persona:** Software engineer

## Story

As a software engineer, I want to request an on-demand investigation into a reported issue on
any given environment, so that I get to a likely cause and a way to mitigate it without
correlating dashboards by hand.

```bash
heimdall investigate "checkouts are not working" --env prod
```

## Items

| # | The user can… | Status | Where |
|---|---|---|---|
| 1 | Receive real-time or near-real-time information in the investigation | in progress | The window is anchored at "now" (the fixture anchor in fixture mode) and compared with the preceding window ([0016](../adr/0016-investigation-init-phase.md)); live queries are the execution phase |
| 2 | See how signals correlate and how the investigation traverses the system | in progress | The init phase emits the located entry, the scoped subgraph and the check plan as typed events ([0016](../adr/0016-investigation-init-phase.md), [0006](../adr/0006-cli-output-contract.md)); the CLI renders them. A console view is not started |
| 3 | Get concise mitigations, from manual intervention to long-term prevention, with trade-offs | not started | Produced at the end of the execution phase |
| 4 | Connect observability, limited data sources, source code, notes and documentation | in progress | Observability through connectors ([0009](../adr/0009-grafana-stack-first.md)); the system manifest describes how the parts connect ([0015](../adr/0015-system-manifest-as-a-traversable-graph.md)). Code, notes and documentation are not started |
| 5 | Benefit from past incidents, since most incidents resemble earlier ones | seam | Past-incident priors are meant to re-rank entry candidates and checks; nothing stores incidents yet |
| 6 | Use predefined runbooks, and search beyond them when allowed | seam | A runbook attached to a manifest vertex is meant to join the scope; runbooks are not modelled yet |
| 7 | Run in read-only mode, investigating only | done | Read-only by construction ([0002](../adr/0002-read-only-blast-radius.md)); the init phase performs no calls against the system at all |
| 8 | Reach it quickly, with minimal authentication but sound security and privacy | in progress | A CLI with user-level config ([0013](../adr/0013-user-level-kubeconfig-style-config.md)) and credentials by env var name ([0008](../adr/0008-egress-allowlist-and-scrub.md)) |

## Notes

- **The init phase** (items 1, 2, 7, 8) turns the free-text query into an entry vertex, a scope
  and an ordered plan of checks. It sends the model only the query and the manifest's compact
  index, never telemetry. See [0016](../adr/0016-investigation-init-phase.md).
- **The execution phase** runs the checks, correlates the results and proposes mitigations
  (items 1, 2, 3). It is next.
- The MVP cut across items is still to be confirmed; the statuses above describe the work, not
  the cut.
