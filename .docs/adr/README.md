# Decision archive

One decision per file, numbered, **append-only**. A superseded record is marked
`Superseded by NNNN` in its Status and is never deleted or rewritten — the reasoning that
looked correct at the time is the most valuable thing in here.

## Template

The template is bifrost's [`process/templates/adr.md`](../../../bifrost/process/templates/adr.md), the same in
every repo of the family. `bifrost new adr "<title>"` starts one from it, with the next number and
its row in the index below.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-command-layer-nest-commander.md) | Command layer: nest-commander | Accepted |
| [0002](0002-read-only-blast-radius.md) | Blast radius: read-only with a mutation seam | Accepted |
| [0003](0003-node-24-runtime.md) | Runtime: pinned Node 24 | Accepted |
| [0004](0004-single-llm-adapter-behind-a-port.md) | LLM port with a single Anthropic adapter | Accepted |
| [0005](0005-native-queries-in-declarative-config.md) | Telemetry config carries native queries | Superseded by 0015 |
| [0006](0006-cli-output-contract.md) | CLI output contract | Accepted |
| [0007](0007-record-replay-and-golden-evals.md) | Eval strategy: replay + judged golden set | Accepted |
| [0008](0008-egress-allowlist-and-scrub.md) | Egress: allowlist plus scrubbing | Accepted |
| [0009](0009-grafana-stack-first.md) | Grafana stack as the first backend | Accepted |
| [0010](0010-no-tui-in-scope.md) | No terminal UI in scope | Accepted |
| [0011](0011-commonjs-and-npm-workspaces.md) | CommonJS output and npm workspaces | Accepted |
| [0012](0012-no-eslint-until-typescript-eslint-supports-ts7.md) | Stream discipline enforced by a guard test | Accepted |
| [0013](0013-user-level-kubeconfig-style-config.md) | User-level, kubeconfig-style configuration | Accepted |
| [0014](0014-fixture-datasources.md) | Fixture datasources behind the connectors' fetch | Accepted |
| [0015](0015-system-manifest-as-a-traversable-graph.md) | System manifest as a traversable graph | Accepted |
| [0016](0016-investigation-init-phase.md) | Investigation init phase: model-classified entry, deterministic scope and plan | Accepted |
| [0017](0017-agent-runtime-loop-tools-budgets-tracing.md) | Agent runtime: loop, tools, budgets and tracing | Accepted |
| [0018](0018-investigation-execution-on-the-agent-runtime.md) | Investigation execution on the agent runtime | Accepted |
| [0019](0019-published-schemas-for-transcripts-and-scorecards.md) | Published schemas for transcripts and scorecards | Accepted |
