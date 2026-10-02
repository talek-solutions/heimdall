# `~/.heimdall/manifest.yaml`

The system manifest of [ADR 0015](../adr/0015-system-manifest-as-a-traversable-graph.md): what
exists, what depends on what, which flows the business runs on and which metrics say "healthy".
Implemented in `libs/core` as the `manifest` subdomain (`@heimdall/core/manifest`).

## Location

| Source | Path |
|---|---|
| `HEIMDALL_MANIFEST` (if set and non-empty) | that path, resolved to absolute |
| default | `~/.heimdall/manifest.yaml` |

One file, describing one system. It is never created for you: a missing file is
`MANIFEST_FILE_NOT_FOUND`. Nothing is loaded at bootstrap; `ManifestModule` provides
`ManifestReader` and the resolved path (`HEIMDALL_MANIFEST_PATH`) for commands that need it.

## Example

[`.docs/manifests/shop/manifest.yaml`](../manifests/shop/manifest.yaml) is the reference manifest,
and its [README](../manifests/shop/README.md) shows what it compiles into.

The file is a stream of YAML documents separated by `---`, each Kubernetes-style:

```yaml
apiVersion: heimdall/v1          # required; the same in every document
kind: Component                  # System | Component | Functionality | Flow
metadata:
  name: services-2               # lowercase letters, digits, dashes; unique per kind
  system: shop                   # required except on the System; must name it
  labels: { team: orders }       # optional
spec: { ... }
```

Anchors and merge keys (`<<: *base`) work within a document.

## Validation

Three stages; each runs only when the previous one passed, so one malformed document is
reported as itself rather than as broken references everywhere else.

**1. Shape — each document on its own**

- Unknown keys are rejected at every level; enums are closed.
- A dependency needs `name`, `target`, `transport`, `mode` and `criticality`.
- An indicator has exactly one of `metric` or `ratio`, and a `role`. `expect` defaults to
  `{ kind: baseline }`; `slo` needs at least one of `min`, `max`, `p50`, `p90`, `p95`, `p99`
  (percentiles are upper bounds), and `threshold` at least one of `min`, `max`.
- A metric's `measures` has exactly one of `inbound: <transport>` or `outbound: <dependency>`.
- Metric `labels` map a label to a known meaning: `route`, `method`, `statusCode`, `outcome`,
  `operation`, `table`, `topic`, `consumerGroup`, `instance`. A step's `match` keys use the same
  meanings.
- Log `fields` map a field to any camelCase meaning, so correlation keys such as `orderId` are
  allowed.
- A flow has at least one step; `propagatesTraceContext` defaults to `true`.
- `provenance` (`declared` | `discovered`) defaults to `declared` on dependencies and metrics.

**2. Assembly — the file as a whole**

- Exactly one `System`; every other resource's `metadata.system` names it.
- No two resources share a kind and name.

**3. References**

- Dependency, metric, member and environment names are unique within their parent.
- `dependsOn[].target` is a declared component.
- `measures.outbound` is a dependency of the same component; `measures.inbound` is a transport
  the component `exposes`.
- A `primary-replica` topology has exactly one `primary` member; `replication` appears only there.
- `Functionality.spec.flows` name declared flows.
- A step's `dependency` is `component/dependency` and resolves.
- Indicator metrics resolve: a bare name against the owning component (component and member
  indicators), otherwise `component/metric`, which functionalities, flows and steps must use.

Not checked here: environment `context` against `~/.heimdall/config.yaml`, coverage lint, and
indicator derivation.

## Error codes

`{ errorCode, message? }` shape. Messages locate the problem, e.g.
`document 3 (Component/services-2) spec.dependsOn.1.criticality: …` or
`Flow/submit-order spec.steps.1.dependency: …`; at most ten issues are listed.

| Code | When |
|---|---|
| `MANIFEST_FILE_NOT_FOUND` | no file at the resolved path |
| `MANIFEST_FILE_UNREADABLE` | the path exists but cannot be read as a file |
| `MANIFEST_PARSE_FAILED` | malformed YAML |
| `MANIFEST_UNSUPPORTED_VERSION` | an `apiVersion` other than `heimdall/v1`, or more than one in the file |
| `MANIFEST_INVALID` | no documents, a non-mapping document, a missing `apiVersion`, or any validation issue |

`heimdall investigate` is the first command that loads the manifest; every code above exits 2
([investigation-plan.md](investigation-plan.md)).
