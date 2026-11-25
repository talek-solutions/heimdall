# talek-lmn — manifest for the live local stack

[`manifest.yaml`](manifest.yaml) describes `talek-lmn-server` as a traversable graph
([ADR 0015](../../adr/0015-system-manifest-as-a-traversable-graph.md)), and
[`config.example.yaml`](config.example.yaml) points Heimdall at the Prometheus, Loki and Tempo
that the suite's own `docker-compose` publishes
([ADR 0013](../../adr/0013-user-level-kubeconfig-style-config.md)).

Unlike [checkout](../checkout/README.md) and [shop](../shop/README.md), this pair is **not**
backed by a fixture scenario. Every metric name, label, label value and log field in it was read
back off the running stack, and the numbers quoted below were measured at
**2026-11-22T08:59Z** over a six-hour window.

The Redis parts were re-read on **2026-11-24**, after `talek-lmn-server` replaced its single Redis
container with a six-node cluster (`687e7a3 feat: add redis cluster`). The cluster's metric names,
labels and values, and both walk plans below, are measured as of that date. The reports routes and the four reporting flows
were read the same day, from the window in which `.load-tests/reports-lifecycle` exercised them.

Their *outcome* numbers are not measured: the talek containers were torn down while this was being
written, and the observability stack followed, so the breach values in the walks are still the
2026-11-22 ones, the node-loss evidence below is what the retained Prometheus history held rather
than a staged fault, and the `reporting` walk has only ever been planned, never executed. Every
query quoted here compiles; which of them return data on a live stack is checked again when the
stack comes back.

```bash
cp .docs/manifests/talek-lmn/config.example.yaml ~/.heimdall/config.yaml   # or merge it

HEIMDALL_MANIFEST=.docs/manifests/talek-lmn/manifest.yaml \
INVESTIGATION_MAX_CHECKS=60 \
heimdall investigate "runs are being rejected" --since 2h
```

**`INVESTIGATION_MAX_CHECKS=60` is not optional for this manifest.** The `reporting` walk plans 49
checks, and the built-in cap of 40 silently drops the last nine — see the walk below. 60 clears the
largest walk with headroom; the other three plan 33 to 35 and are unaffected either way. There is
no config-file field and no flag for it, so it has to be the environment variable on every run.

`--plan-only --entry functionality:load-testing` stops after the plan with no model call at all,
which is how every claim here was checked. The full run needs `ANTHROPIC_API_KEY`.

## Scope of this manifest

The `rca` application and its Mongo store are deliberately absent. `rca` sits behind a compose
profile, its container is not up, and `Transport` has no `mongo` member — and `rca`'s own
`sre/services/rca.yaml` states the policy this follows: *a dependency with no observability is
worse than none.* Prometheus still holds `job="rca"` series from earlier runs; `platform`'s
matcher `{job: platform}` excludes them.

Four more vertices were considered and cut for the same reason: `prometheus`, `loki`, `tempo` and
`grafana` sit on no flow step and have no scrape job, so they could only ever be reported as
blind spots. `benchmark-server` is the target the Fargate runners load, not a dependency of
`platform`, and is unscraped.

`client` is the one component with no telemetry that *is* declared. It is not an exception to the
rule above: it carries the inbound hop of each flow, and without it `http_server_duration` has no
step to serve, so the route's error and latency checks never get planned at all.

`client` also stands in for the redeemer on `fetch-config`'s third step. In production that caller
is the dispatched Fargate task, not the minter, but no reverse dependency from `aws-ecs` back into
`platform` is declared — and under the `.load-tests` scenarios that drive this route the script is
genuinely both callers, so the stand-in is literally true for the traffic the walk is read against.

## The system

| Kind | Resources |
|---|---|
| `System` | `talek-lmn`, environment `local` → context `talek-local` |
| `Component` | `client`, `platform`, `postgres-main`, `redis-cache`, `aws-ecs` |
| `Member` | `redis-cache/node-1` … `node-6`, `mode: cluster`, all `role: node` |
| `Functionality` | `load-testing`, `identity`, `config-delivery`, `reporting` |
| `Flow` | `start-run`: 3 steps, async, no trace context · `sign-in`: 2 steps, sync · `fetch-config`: 4 steps, async, no trace context · `publish-report`: 3 steps, sync · `fetch-report`: 3 steps, sync · `list-reports`: 2 steps, sync · `delete-report`: 3 steps, sync |

It compiles to 83 vertices and 111 edges, with 37 indicators: 20 declared, 17 derived.

### The Redis cluster is one component with six members

The six nodes are **one** `Component` with six `topology.members`, not six components. That is what
the stack itself says: the exporter relabels every node to `instance="redis-local"`,
`sre/dependencies/redis.yaml` selects on that label, and `sre/services/platform.yaml` binds
`redis-cache` to it. The cluster is one dependency of the platform.

That join key is **metrics-only**. The platform's `OTEL_DATASTORE_NAMES` looks as though it extends
it to traces, and this README said so for a day, but it maps node hostnames while the cluster
client connects by IP — see the coverage finding. Nothing in Tempo ever says `redis-local`.

`role: node` for all six is deliberate: it claims nothing about which node is a master, because
**roles move**. The nodes were created as masters 1, 2, 3 with replicas 4, 5, 6; minutes later
`cluster nodes` reported masters 4, 5, 2 with replicas 1, 6, 3, after a restart triggered a
failover. A manifest that encoded `primary`/`replica` per node would have been wrong within
minutes, which is also why `redis_connected_slaves` is declared as context and not as a check.

The members exist to carry the liveness check, not for decoration — see the `max()` coverage
finding below. A member with no indicators is a blind spot by construction (`check.planner.ts`'s
`BLIND_SPOT_TYPES` includes `Member`), so six decorative members would have added six
`no-indicators` reports to every walk that reaches the cache.

The declared-to-derived ratio is the inverse of checkout's on purpose. `talek-lmn-server` carries
its own signal catalogue in `sre/dependencies/*.yaml` with agreed thresholds, so declaring
`threshold` and `slo` expectations preserves the team's own judgement rather than replacing it
with `~baseline`.

## What the model is shown

The level-0 index, the only part of the manifest the classification call sees:

```text
system talek-lmn · env local — Load-test platform that records runs and dispatches Fargate runners to execute them
functionality:load-testing — Users start load-test runs, which Fargate tasks execute against a target
  flow:start-run  async, no trace context, join on runId: client/platform-api POST /runs ▸ platform/postgres-main INSERT ▸ platform/dispatch-ecs-task — POST /runs records the run, then dispatches a Fargate task after the response is sent
functionality:identity — Users sign in and receive a token for the API
  flow:sign-in  sync: client/platform-api POST /auth/login ▸ platform/postgres-main SELECT — POST /auth/login verifies the credentials against Postgres and issues a token
functionality:config-delivery — A run's configuration is handed over out of band. The caller mints a single-use presigned signature, and whoever executes the run redeems it once for the config behind it
  flow:fetch-config  async, no trace context: client/platform-api POST /config-signatures ▸ platform/postgres-main INSERT ▸ client/platform-api GET /public/config-signatures/:signature ▸ platform/postgres-main SELECT — POST /config-signatures mints a single-use signature; GET /public/config-signatures/:signature redeems it. Minting and redeeming are separate transactions, so a failure on the second hop says nothing about the first
functionality:reporting — The CLI publishes a load-test report against a personal access token, and reports are read back through a cache in front of Postgres
  flow:publish-report  sync: client/platform-api POST /reports ▸ platform/postgres-main INSERT ▸ platform/report-cache — POST /reports stores the report and primes the cache. A PAT scope guards it, and a 401 is its most common outcome by two orders of magnitude
  flow:fetch-report  sync: client/platform-api GET /reports/:reportId ▸ platform/report-cache ▸ platform/postgres-main SELECT — GET /reports/:reportId reads the cache first and falls through to Postgres on a miss, where a hit also re-primes the cache. A miss costs latency, never correctness
  flow:list-reports  sync: client/platform-api GET /reports ▸ platform/postgres-main SELECT — GET /reports pages a user's reports straight from Postgres, with no cache involved
  flow:delete-report  sync: client/platform-api DELETE /reports/:reportId ▸ platform/postgres-main DELETE ▸ platform/report-cache — DELETE /reports/:reportId hard-deletes the row and drops the cache entry. No part of this flow has been observed on this stack
component:client  frontend — The callers of the API: the web app and the scripts that drive load tests. Emits no telemetry of its own; it is here to anchor the inbound hop of the flow. → platform http sync hard
component:platform  service — NestJS API on :3002. OTel auto-instrumentation, Prometheus exporter scraped on :9464 as job `platform`, OTLP traces to Tempo, pino logs shipped by promtail. → postgres-main sql sync hard · redis-cache redis sync soft · aws-ecs http async hard
component:postgres-main  datastore postgresql — Primary store for users, configurations, runs and reports; postgres_exporter as `postgres-local`
component:redis-cache  cache redis — Report cache: a six-node cluster, three masters with one replica each, behind a single redis_exporter in multi-target mode. All six scrape as `instance: redis-local`, with `redis_node` telling them apart. Observed through metrics only: its spans carry node IPs, not the logical name. Memory pressure is expected here and is not a check
  member:redis-cache/node-1  node
  member:redis-cache/node-2  node
  member:redis-cache/node-3  node
  member:redis-cache/node-4  node
  member:redis-cache/node-5  node
  member:redis-cache/node-6  node
component:aws-ecs  vendor — ECS RunTask on Fargate. No exporter of its own; observed only through platform's own HTTP client histogram, narrowed to the ECS endpoint.
```

## Indicators

Thirty-five of the thirty-seven compile to PromQL without a `query:` string. Every shape below was
run against the live Prometheus before being declared — but note what that did *not* prove: a
hand-written query omits the environment matchers the compiler injects, so these shapes were
verified while the manifest was in fact returning no metric data at all. See the first coverage
finding.

| Subject | Role | Compiles to | Source signal |
|---|---|---|---|
| `step:start-run#1`, `step:sign-in#1`, `step:fetch-config#1`, `step:fetch-config#3`, and the first step of all four reporting flows | throughput, errors, latency | the three shapes below, narrowed by `http_route` and `http_method` | derived from the step's `match` |
| `step:start-run#2`, `step:sign-in#2`, `step:fetch-config#2`, `step:fetch-config#4`, `step:publish-report#2`, `step:fetch-report#3`, `step:list-reports#2`, `step:delete-report#2` | throughput, latency | the same shapes on `db_client_operation_duration`, narrowed by `db_operation_name` | derived from the step's `match` |
| `step:publish-report#3`, `step:fetch-report#2`, `step:delete-report#3` | — | nothing; these are the Redis hops and carry no indicator at all | blind spots by declaration, see the coverage findings |
| `component:platform` | errors ≤0.01 | `sum(rate(http_server_duration_count{http_status_code=~"5..",job="platform"}[5m])) / sum(rate(http_server_duration_count{job="platform"}[5m]))` | `server-error-ratio` |
| `component:platform` | errors ≤0.2 | **native** `…{http_status_code=~"4.."…} / …` | `client-error-ratio` |
| `component:platform` | latency p95 ≤100 | `histogram_quantile(0.95, sum by (le) (rate(http_server_duration_bucket{job="platform"}[5m])))` | `latency-p95-high` |
| `component:platform` | saturation ≤0.9 | `sum(v8js_memory_heap_used{…}) / sum(v8js_memory_heap_limit{…})` | `heap-near-limit` |
| `component:platform` | saturation ≤0.5 | `max(nodejs_eventloop_utilization{job="platform"})` | `event-loop-saturated` |
| `component:platform` | saturation ≤0 | `max(db_client_connection_pending_requests{job="platform"})` | pool exhaustion |
| `component:postgres-main` | saturation ≥1 | `max(pg_up{instance="postgres-local"})` | `pg-down` |
| `component:postgres-main` | saturation ≤0.5 | `sum(pg_stat_activity_count{…}) / sum(pg_settings_max_connections{…})` | `pg-connection-saturation` |
| `component:postgres-main` | errors ≤0 | `sum(rate(pg_stat_database_deadlocks{…}[5m]))` | `pg-deadlocks` |
| `member:redis-cache/node-1` … `node-6` | saturation ≥1 | `max(redis_up{instance="redis-local",redis_node="redis-node-N"})` | `redis-down`, one check per node |
| `component:redis-cache` | saturation ≤0 | `max(redis_cluster_slots_fail{instance="redis-local"})` | slot coverage, the catalogue's `aggregation: worst` |
| `component:redis-cache` | errors ≤0 | `sum(rate(redis_evicted_keys_total{…}[5m]))` | `redis-evictions` |
| `component:aws-ecs` | throughput >0 | `sum(rate(http_client_duration_count{job="platform",net_peer_name="ecs.…"}[5m]))` | `ecs-calls-absent` |
| `component:aws-ecs` | errors ≤0.05 | **native** `…{http_status_code!~"2.."…} / …` | `ecs-call-error-ratio` |
| `component:aws-ecs` | latency p95 ≤2000 | `histogram_quantile(0.95, sum by (le) (rate(http_client_duration_bucket{…}[5m])))` | ECS call latency |

### The two native queries, and why they are unavoidable

`PromQlCompiler` hard-codes `ERROR_STATUS = '5..'` for a `statusCode` label and
`ERROR_OUTCOME = 'error'` for an `outcome` one. Both of this system's interesting failure modes
sit outside that:

- The throttler rejects with **429**, so the derived 5xx ratio cannot see the system's own
  rejection path.
- AWS rejects missing or invalid credentials with **400**, so the same applies to the dispatch.

A `query:` costs the indicator its labels and its unit, which is why the per-route breakdown is
left to the derived step indicators and only the component-wide ratios are native. Two is under
ADR 0015's "revisit the compiler" tripwire; the first draft of this manifest had seven, and five
of them were the compiler's job.

**The Redis cluster added none.** It was first drafted with a third override,
`min(redis_up{instance="redis-local"})`, to get worst-across-nodes aggregation out of a compiler
whose gauge template only emits `max()`. Declaring the nodes as `topology.members` removes the
need: a member's matchers are merged into the selector (`promql.compiler.ts`, `memberIdentity`),
so the query narrows to a single series and `max()` over one series is the identity. The check is
exact per node, keeps its `boolean` unit and its labels, and names the faulty node — none of which
an override can do, since a native query returns `labels: []` and `unit: ''`.

That is worth keeping straight, because the count only means something if every override marks a
real compiler gap. The two here do: `ERROR_STATUS = '5..'` cannot see this system's 429 or AWS's
400. An override bought to change an aggregation would have jammed that signal, leaving the next
reader unable to tell which of four were the compiler's fault.

### Why `http_client_duration`, not the Tempo span metrics

`traces_spanmetrics_calls_total` looks like the natural signal for a vendor with no exporter, and
it was the first choice. It was rejected on live evidence:

- Tempo's metrics generator currently emits exactly **one** live series,
  `span_name="GET"`, `SPAN_KIND_SERVER`. `span_name="ECS.RunTask"` has had no sample in six hours
  and no trace in seven days.
- The remote-written series carry `service`, never `job` — `sre/dependencies/aws-ecs.yaml`
  records the same caveat.
- Its `status_code` values are `STATUS_CODE_ERROR` / `STATUS_CODE_UNSET`, which the compiler's
  `ERROR_OUTCOME = 'error'` never matches. Mapping the label as `outcome` would have derived a
  ratio that is silently always empty.

`http_client_duration` is scraped straight from `platform`'s own exporter, so it is exactly as
reliable as every other check here.

## Walks

### `runs are being rejected`

Entry `functionality:load-testing`, hop budget 1: **33 checks**, 20 vertices in scope and 9 ruled
out. `c1`–`c2` localise on the flow's hops, `c1` with the route-scoped triple; `c3`–`c8` explain
`platform`; `c9`–`c15` are the sibling steps that `platform` and `postgres-main` also serve, four
of them now the reporting flows; `c16`–`c19` reach `postgres-main`, `c20`–`c22` `aws-ecs`,
`c23`–`c24` `redis-cache` and `c25`–`c30` its six nodes; `c31`–`c33` corroborate with logs.

Re-measured on 2026-11-24, and the figure has moved twice in one day: **23** against the
pre-cluster manifest, **29** with the cluster, **33** with the reporting flows — none of them the
"20 checks, nothing ruled out" recorded here on 2026-11-22. The drift predates both changes and is
the last coverage finding in action: nothing fails when these figures go stale, because no spec
loads this manifest.

On the live window of 2026-11-22, two checks breach:

| Check | Measured | Expected |
|---|---|---|
| `component:platform` errors (4xx) | **0.221** (0.229 on `/runs` alone) | ≤0.2 |
| `component:aws-ecs` throughput | **no data** | >0 |

The p95 on `/runs` is 18.9 ms against a 100 ms SLO and the 5xx ratio returns **no data at all** —
there is no `5..` series in the window, and Prometheus division with an empty numerator yields
empty rather than zero. An evaluator that reads empty as "unhealthy" would invert this result, so
it is worth knowing that a healthy error ratio here is absent, not `0`.

### `signature redemptions are failing`

Entry `functionality:config-delivery`, hop budget 1: **35 checks** (25 before the cluster, 31 with
it), 21 vertices in scope and 9 ruled out. `c1`–`c4` localise across the flow's four hops; `c3` is
the one that matters — the route-scoped triple on `step:fetch-config#3`, which is what
`.load-tests/signature-replay-410` and `.load-tests/signature-expiry-410` drive. `c5`–`c10`
explain `platform`, with the native 4xx query at `c6`; `c11`–`c16` are the sibling steps, four of
them the reporting flows; `c17`–`c20` reach `postgres-main`, `c21`–`c23` `aws-ecs`, `c24`–`c25`
`redis-cache` and `c26`–`c31` its six nodes; `c32`–`c35` are the logs and traces.

It was run on 2026-11-22 against `.load-tests/signature-replay-410`, 10 workers for 240s, on an
otherwise idle stack. The load test's own tally:

```
Replays sent : 481988      Throughput : 2007.93 req/s
Status codes : {"410":39975,"429":442013}
Signal purity: 442013 unexpected responses
Pool refresh failed: burn failed: expected 200, got 429
```

**The scenario does not produce what its own README describes, on this stack.** Ten workers against
a 5 ms endpoint reach ~2000 req/s, and the global `short` throttle is 10000/60s ≈ 166 req/s — keyed
on IP here, because the redemption route is unauthenticated and `UserThrottlerGuard` only prefers
`userId` when a request carries one. So 92% of the traffic is `429` and only 8% is the intended
`410 CONFIG_SIGNATURE_ALREADY_CONSUMED`. The second pool generation never happened either: the
refresh's own mint-and-burn was throttled. The purity counter does flag the 442,013 unexpected
responses, but its advice line blames an aged-out pool and tells you to lower `POOL_REFRESH_MS`,
when there were zero `EXPIRED` responses. Getting the documented scenario needs concurrency that
stays under the throttle budget, or pacing between requests.

What the checks returned. The IDs are the ones that run printed on 2026-11-22; the subject is given
too, because **`c13` and `c14` are no longer the Postgres checks** — the reporting flows insert six
sibling-step checks at `c11`–`c16` and push the component's own checks to `c17`–`c20`. Everything
`c1`–`c10` still names the same subject it did then:

| Check | Subject | Result | Measured |
|---|---|---|---|
| `c6` 4xx ratio ≤0.2 | `component:platform`, native | **breached** | 0 → 1.0 |
| `c9` event-loop ≤0.5 | `component:platform` | **breached** | 0.00309 → **0.997** (323×) |
| `c2` `c3` `c4` throughput | the flow's own hops | anomalous | onset 20:04:26–20:04:42, peak 2246/s |
| `c7` p95 ≤100 ms | `component:platform` | met | — |
| `c8` heap, `c10` pool pending | `component:platform` | met | — |
| `c13` `c14` postgres → now `c17`–`c20` | `component:postgres-main` | met | — |
| `c1` mint hop, `c5` 5xx ratio, `c3` errors | — | no data | — |

`c3`'s errors being empty is the behaviour predicted above: a 410 and a 429 are both 4xx, and the
step's derived ratio only knows `5..`. `c5` is empty for the same reason. The breach lands on `c6`,
the component's native 4xx query, exactly as expected.

Heimdall returned **`cause-found`, confidence 0.72**, naming `component:client` with origin
`step:fetch-config#3`, and got the mechanism right including the part I had to work out by hand:
it compared the redemption rate (~2246/s) against the mint rate (~0.58/s), identified the
throttler's 429s *and* the already-consumed rejections as two layers of the same storm, and stated
that "platform and Postgres are behaving as designed". It flagged `component:client` as a blind
spot that its own conclusion rests on.

Measured against the ground truth, this is a **partial pass, and the ground truth is the part
that is wrong**. `rca-case-signature-replay.md` expects `NO_FAULT` on the premise that replay is
benign — true of a modest replay, but not of 2000 req/s that saturates the event loop to 0.997.
`cause-found` pointing at the caller is the better answer to what actually happened. The test
needs fixing before the document's verdict can be graded fairly.

**The test has since been paced** (`TARGET_RPS`, default 40, with per-iteration pacing in the
worker loop) and its purity report now names `429` throttling as a distinct cause instead of
blaming the pool. The clean re-run has **not** happened: the talek stack's containers were removed
while it was being set up, so the numbers above remain the only measured ones, and the grading
against `NO_FAULT` is still open.

Two artefacts to know about. The `c6` and `c9` onsets (19:58:14, 19:57:42) predate the load by
seven minutes: on a near-idle stack a single error request makes the ratio 1.0, and a `404` probe
sent by hand at ~19:57 is what the onset detector locked onto. And `c17`–`c19` (`aws-ecs`) did not
appear in this run's evidence at all, because the walk never localised at a step that reaches
that dependency — the standing `ecs-calls-absent` breach stays a hazard for other walks rather
than this one.

### `report reads are slow` — and the check cap

Entry `functionality:reporting`, hop budget 1: **49 checks**, all of them kept — but only because
the cap is raised. Plan-only, measured 2026-11-25; it has never been run against live data.

At the built-in `DEFAULT_MAX_CHECKS = 40` this walk reports `… 9 more checks over the cap`.
`check.list.ts` sorts by tier and slices from the end, and the tier order is Confirm, Localise,
Explain, Corroborate, Impact, so what goes is the tail of **Corroborate**: `c41`–`c49`, every one
a log or trace query, among them the traces for `GET /reports/:reportId`, the route the walk is
about. No metric check is ever dropped — the Localise and Explain tiers survive intact, Redis
checks included — so the truncated walk still reaches a conclusion, with less to corroborate it
and nothing in the exit code to say so.

**`INVESTIGATION_MAX_CHECKS=60` is the answer here, not fewer flows.** The four reporting flows are
what push the walk over, and `delete-report` alone costs six checks it can never use — but dropping
it only reaches 43, still over. The full API surface is worth more than the nine corroboration
queries, so the manifest keeps it and the run raises the cap. Verified at 60: `reporting` 49,
`config-delivery` 35, `identity` 34, `load-testing` 33, none truncated.

Two things to know about that number. It is **per run and per environment**: `DefaultsConfig`
carries only `output` and `logLevel`, `investigate` has no `--max-checks` flag, so nothing in
`config.example.yaml` can hold it and a run that forgets it is quietly back to 40. And the cap is
there to bound cost — every kept check is a query the agent may issue — so 60 buys completeness on
this stack, not a reason to raise the built-in default for `shop` and `checkout` too.

### `Postgres is down`

Entry `functionality:load-testing` again. `pg_up` is the catalogue's top-rank critical signal and
`sre/services/platform.yaml` declares that `postgres-main/pg-down` *explains* both
`server-error-ratio` and `latency-p95-high`, so this is the walk that separates an agent that
names Postgres from one that reports "5xx is high". It cannot be staged without stopping the
container, so it is left as a manual exercise rather than written up as a result.

## Coverage findings

- **The System's environment must not carry `labels`, and this was found the hard way.** An
  environment's labels are injected as equality matchers into *every* compiled metric selector
  (`promql.compiler.ts:149`, `...equal(environmentLabels)`). This manifest first declared
  `labels: { env: local }`, and because nothing in the talek stack tags series with `env`, all 34
  metric queries of a live investigation returned `[]` — the run reached a conclusion from traces
  alone and reported "every metric check returned no data" as a finding against the *stack*. The
  exporter has zero series carrying `env=`. `checkout` declares its environment with no `labels`
  at all, which is the correct pattern here. Note the asymmetry: platform's *log* records do carry
  an `env` field, which the allowlist drops; that is unrelated to the metric label and does not
  justify the matcher.
  **`--plan-only` cannot catch this.** The plan prints indicator subjects and expectations, not
  compiled PromQL, and the queries only acquire the environment matchers at execution. Verifying
  indicator shapes by hand against Prometheus does not catch it either, because a hand-written
  query does not include the injection. The only check that catches it is a real run — or reading
  the compiled `query` out of a transcript in `~/.heimdall/runs`.
- **A liveness gauge on a multi-series component compiles to a check that cannot fail, and this
  is what the cluster exposed.** `templateFor` in `promql.compiler.ts` compiles a gauge with
  `role: saturation` to `max(metric{selector})` unconditionally. For an upper bound that is the
  correct worst case; for a lower bound like `expect { min: 1 }` it is the *optimistic* one. With
  six nodes sharing `instance="redis-local"`, the component-wide `redis_up` check read healthy
  unless every node was down. Measured at **2026-11-24T19:01:47Z**, with `redis-node-1`
  unreachable:

  | Query | Value |
  |---|---|
  | `max(redis_up{instance="redis-local"})` — what the component check compiled to | **1**, healthy |
  | `min(redis_up{instance="redis-local"})` — what the catalogue declares | **0** |
  | `max(redis_up{instance="redis-local",redis_node="redis-node-1"})` — the member check | **0**, breaches |

  The members are the fix, and they are strictly better than the `min()` override that was drafted
  first: exact per node, unit and labels kept, and the breach names the node — which is what the
  cluster's new Grafana annotations tell the operator to do.

  **This is not Redis-specific.** `postgres-main`'s `pg_up` carries the identical defect, hidden
  only because Postgres is a single instance here, and so would any liveness gauge on a component
  whose exporter emits more than one series. The class-wide fix belongs in the compiler — when an
  expectation carries `min` and no `max`, a gauge's saturation template should emit `min()` — and
  is deliberately left out of this change. It is recorded here rather than as an ADR because it
  changes compiled output for every existing manifest, which is a decision of its own.

  Note how it was found: by querying the live exporter, not by reading the manifest or the plan.
  `--plan-only` prints `threshold ≥1` against `redis-cache/redis_up` and looks perfectly correct.

- **`redis_node` and the six member names are a contract with another repo.** The label exists only
  because `talek-lmn-server`'s `prometheus.yml` relabels it there, and the member matchers hard-code
  `redis-node-1` … `redis-node-6` to match its compose service names. Rename that relabel or resize
  the cluster and all six member checks return empty rather than failing loudly — the same staleness
  trap ADR 0015 names. The join key is written into the manifest's own comment; the server side
  records its caveats in `sre/dependencies/redis.yaml`, where this one belongs too.

- **`redis-evictions` cannot breach on this stack.** The cluster nodes run with no `maxmemory`, so
  nothing is ever evicted — which is also why `sre/services/platform.yaml` mutes
  `redis-memory-pressure` for this consumer. It joins the 5xx ratio on `fetch-config#3` as a check
  that is empty by construction here; `incident-scenarios.md` SC-05 sets `maxmemory` on one node
  temporarily to make it fire.

- **The node-loss evidence is observational, not staged.** The divergence above was caught because
  a node happened to restart while the cluster was being read; the three faults SC-02 describes
  (replica loss, master loss with failover, master *and* replica with slots uncovered) were never
  deliberately produced, and the stack was torn down before they could be. So
  `redis-cluster-slots-uncovered` is verified only in its healthy state: at the node-1 outage,
  `max(redis_cluster_slots_fail{instance="redis-local"})` was `0` and
  `min(redis_cluster_state{…})` was `1`, which is the right answer — one node down leaves slot
  coverage whole — but it is not proof that the check fires when coverage is actually lost. Staging
  variant (c) is the open item, with `docker compose exec redis-node-1 redis-cli cluster info`.

- **`step:start-run#3` has no indicators.** The dispatch is fired after the response, so no
  per-run signal exists for it; the `aws-ecs` component indicators cover the dependency, but not
  the individual run. Heimdall reports it as a blind spot, which is the honest answer.
- **`correlationKey: runId` resolves to nothing.** Every request line is pinoHttp's
  `request completed`, with `req`, `res`, `responseTime`, `trace_id` and `span_id` — and no
  `runId`. The key is declared anyway so the evidence names it with an empty value list instead
  of hiding the gap. Adding `runId` to that line in `platform` would close it.
- **`propagatesTraceContext: false` is unverified.** No `ECS.RunTask` span has reached Tempo in
  seven days, so whether the dispatch stays in the request's trace could not be observed. `false`
  is the conservative reading of `sre/services/platform.yaml`'s `propagation: async`. Exercise a
  dispatch and check with
  `curl -sG localhost:3200/api/search --data-urlencode 'q={name="ECS.RunTask"}'`.
- **`req.url` is mapped to `url`, not `route`.** pino logs the raw URL with its query string
  while the metric label is a route template, and `narrow()` drops a record whose mapped field
  disagrees with the step's match. As `route` it would have silently discarded every paginated
  line; as `url` the match is reported ignored for logs and the narrowing falls to `method`.
- **`severity` is a pino numeric level** (30 info, 40 warn, 50 error), not a word. Nothing filters
  on it — the evidence only tallies the most common value — so it is accurate, just terse.
- **`/users` has no `http_route` series; `/reports` does, and this finding used to say otherwise.**
  Until 2026-11-24 this read "`/reports` and `/users` still have no `http_route` series", and gave
  that as the reason no flow covered them and `dependency:platform/report-cache` sat on no step.
  `/reports` and `/reports/:reportId` now carry substantial traffic, so `flow:publish-report`,
  `flow:fetch-report`, `flow:list-reports` and `flow:delete-report` cover them and the cache is on
  a step at last. `/users` genuinely still has none and stays unmodelled, as do `/auth/register`
  and `/auth/pats`, which *do* have series but no flow.
  `/config-signatures` and `/public/config-signatures/:signature` are covered by
  `flow:fetch-config` — the route template on the live exporter is
  `http_route="/public/config-signatures/:signature"`, confirmed against a `404` probe.
- **The Redis cluster's spans never reach `redis-local`, and the manifest claimed they did.** When
  the cluster was first modelled, this README and the manifest both stated that the logical
  datastore name is the join key in traces as well, on the strength of the server's
  `OTEL_DATASTORE_NAMES` comment. That is false: the span processor maps node *hostnames*, while
  ioredis in cluster mode connects to the IPs the cluster hands out. Tempo holds exactly one
  `server.address` value, `postgres-local`, and `net.peer.name` values
  `172.28.0.11`–`172.28.0.16`. The join key is a metrics-only arrangement — taken from a code
  comment instead of the data, which is the one thing this manifest is supposed never to do.
- **The three Redis hops carry no indicator and no `match`.** There is no Redis client metric at
  all (`db_system` has only `postgresql`), so a cache step can derive nothing. Nor can it be
  narrowed: `LabelSemantic.Operation` compiles to `span.db.operation.name`, and the Redis spans
  carry no such attribute — only `db.statement` (`hmget talek:report:… data userId`), which no
  semantic maps to. Declaring `match: { operation: HMGET }` would therefore have filtered to
  nothing while looking correct, so the steps are declared bare and report as `no-indicators`
  blind spots, like `step:start-run#3`. What this costs is **per-route attribution**: no check can
  say that *this* route's cache calls were slow or absent, and `fetch-report`'s Postgres hop
  measures the miss rate rather than the hit rate. It does **not** mean the hit rate is
  unobservable, which an earlier draft of this finding claimed. The exporter publishes
  `redis_keyspace_hits_total` and `redis_keyspace_misses_total`; on 2026-11-25, under a 360 req/s
  load test on `GET /reports/:reportId`, they read **357 hits/s against 0 misses/s**. They are
  cluster-wide and count every key lookup rather than this cache's, which is why they are not
  declared as an indicator — on this stack nothing else uses Redis, so they are the report cache's
  hit rate in practice, and worth declaring once a second consumer makes that untrue.
- **`report-cache` declared the wrong operations until 2026-11-24.** It said `[GET, SETEX]`.
  `RedisService` exposes only `hmset`, `hmget` and `del`, and `hmset` is an `HSET` followed by an
  `EXPIRE`; the declaration is now `[HMGET, HSET, EXPIRE, DEL]`. Nothing broke, because no step
  matched on them — which is exactly why it went unnoticed.
- **Every reports route's dominant failure mode is a 4xx.** `POST /reports` answered **105,844**
  requests with `401` against 640 `201`s, and `GET /reports/:reportId` **8,299** `429`s against
  31,147 `200`s. Both derived step error ratios hard-code `5..`, so neither can see the normal
  failure of either route; `component:platform`'s native 4xx query is the only check that can.
  That is the third instance of the same trap in this manifest, after the throttler and ECS.
- **`flow:delete-report` cannot fail.** `DELETE /reports/:reportId` has no `http_route` series and
  `db_operation_name` has no `DELETE` value over 24 hours, so every indicator the flow derives is
  empty by construction. It is declared to complete the API surface, as a statement of what should
  happen rather than a check. It is also what makes `INVESTIGATION_MAX_CHECKS=60` necessary: six of
  the nine checks that overflow the default cap are its, spent on a path that cannot report
  anything.
- **`db_operation_name` shows `START`, `SELECT`, `INSERT`, `COMMIT`, `CREATE` and now `UPDATE`.**
  The dependency declares the first four; `CREATE` is migration DDL at boot. This finding used to
  say no `UPDATE` or `DELETE` had been observed; over the last 24 hours `UPDATE` has 52 samples,
  while `DELETE` still has none. `step:fetch-config#4` therefore still matches `SELECT` and not the
  `UPDATE` that claims the signature, but for one reason rather than two:
  `ConfigSignaturesService.consume()` runs `findOneBy` on every redemption whatever the outcome and
  reaches the consumed-claim `UPDATE` only when the signature has not expired, so an `UPDATE` match
  would be empty under the very expiry scenario the flow exists to explain. The "no live series to
  compile against" half of the argument no longer holds.
- **Nothing on `flow:fetch-config`'s redemption step can fail with a 5xx.** The four failure modes
  are `404 CONFIG_SIGNATURE_NOT_FOUND`, `403 CONFIG_SIGNATURE_TAMPERED`,
  `410 CONFIG_SIGNATURE_EXPIRED` and `410 CONFIG_SIGNATURE_ALREADY_CONSUMED`. The step's derived
  errors indicator hard-codes `5..`, so it is empty by construction and the component's native 4xx
  query is the only check that can catch a breach here. The `errorCode` that separates the four
  lives in the response body, which no metric label and no mapped log field carries.
- **A hard dependency is reached from any step its component serves.** The `sign-in` walk plans
  `aws-ecs` checks because `platform` depends on it hard, even though login never dispatches a
  task. That is the hop-budget rule, not a manifest error.
- **The ECS matcher pins the region.** `net_peer_name: ecs.eu-central-1.amazonaws.com` is an
  equality match — `MetricsIdentitySchemaV1.matchers` is `Record<string, string>` with no
  operator — so it must change with `AWS_REGION`.
- **No test covers the reference manifests.** Neither this one nor `checkout` and `shop` are
  loaded by a spec, so a schema change would not fail the build here.

## What leaves the machine

The `fields` map is the egress allowlist
([ADR 0008](../../adr/0008-egress-allowlist-and-scrub.md)): an unmapped field never reaches
the model. That matters concretely here, because a live `request completed` line carries
`req.headers.authorization` with a working bearer token whose payload identifies a real user.
`req.headers`, `req.query`, `req.params`, `req.remoteAddress`, `req.remotePort` and `time` are all
left unmapped, so none of it is ever sent.

`req.url` is the one mapped field that can carry caller input, since pino writes the query string
into it. On this API those parameters are pagination, and the config's scrubbers are the second
line of defence: `jwt`, `awsAccessKey`, `connectionString`, `privateKey`, `email` and
`bearerToken`, plus one pattern of talek's own for the platform's personal access tokens,
`lmn_pat_` followed by 43 base64url characters.
