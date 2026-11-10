# User stories

What Heimdall is for, from the point of view of the people who use it. One story per file,
numbered. Stories change as understanding improves; unlike ADRs they are edited in place, and
each item carries its own status so progress stays visible without a separate tracker.

A story says **what** and **why**. **How** lives in the ADRs each item links to.

## Template

The template is bifrost's
[`process/templates/user-story.md`](../../../bifrost/process/templates/user-story.md), the same in
every repo of the family. `bifrost new us "<title>"` starts one from it, with the next number and
its row in the index below.

## Status

The statuses and what they mean are bifrost's
[`process/statuses.md`](../../../bifrost/process/statuses.md#items), the same in every repo of the
family.

## Index

| # | Title | Priority | Persona |
|---|---|---|---|
| [US-001](US-001-on-demand-investigation.md) | On-demand investigation | High | Software engineer |
| [US-002](US-002-incident-notifications.md) | Incident notifications with pre-analysis | Low | SRE responder |
