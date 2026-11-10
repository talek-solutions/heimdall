# Delivery stories

How the product stories in [`.docs/user-stories`](../user-stories/README.md) are delivered, one
slice at a time. A folder holds the stories of one decision (`NNNN-<adr-slug>/`) or of one
component (`<component>/`); a story inside it is numbered within the folder.

A product story (`US-NNN`) says what a user needs. A delivery story says what one slice makes
true, how that is checked, and which ADR explains the how. Each delivery story links up to the
US-001 item, or other product item, it advances. Like product stories, they are edited in place
and every item carries its own status.

## Template

The template is bifrost's
[`process/templates/delivery-story.md`](../../../bifrost/process/templates/delivery-story.md), the
same in every repo of the family.
`bifrost new ds "<title>" --folder <folder> --advances US-NNN#n --decided-in ADR-NNNN` starts one
from it, with the next number and its row in the index below.

Statuses are those of the product stories: `done`, `in progress`, `planned`, `seam`,
`not started` ([meanings](../user-stories/README.md#status)).

## Index

### [0017 — Agent runtime](0017-agent-runtime/)

| # | Title | Status |
|---|---|---|
| [0017-01](0017-agent-runtime/01-tools-repository-and-provider-ports.md) | Tools repository and provider tool ports | done |
| [0017-02](0017-agent-runtime/02-agent-loop-and-budgets.md) | Agent loop and budgets | done |
| [0017-03](0017-agent-runtime/03-agent-observability-and-tracing.md) | Agent observability and tracing | done |

### [0018 — Investigation execution](0018-investigation-execution/)

| # | Title | Status |
|---|---|---|
| [0018-01](0018-investigation-execution/01-metrics-investigation.md) | Metrics investigation | done |
| [0018-02](0018-investigation-execution/02-logs-and-traces-evidence.md) | Logs and traces evidence, with redaction | done |
| [0018-03](0018-investigation-execution/03-mitigations-and-report.md) | Mitigations and report | in progress |
| [0018-04](0018-investigation-execution/04-replay-and-golden-evals.md) | Replay and golden evaluations | in progress |

### [0019 — Published schemas](0019-published-schemas/)

| # | Title | Status |
|---|---|---|
| [0019-01](0019-published-schemas/01-schemas-and-the-pinning-spec.md) | Schemas and the pinning spec | done |
| [0019-02](0019-published-schemas/02-run-identity-and-atomic-writes.md) | Run identity and atomic writes | planned |
| [0019-03](0019-published-schemas/03-source-call-linked-to-its-result.md) | Source call linked to its result | planned |
