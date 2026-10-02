# checkout: reference manifest for the fixtures

[`manifest.yaml`](manifest.yaml) describes the system the telemetry fixture scenarios in
`libs/telemetry/scenarios` simulate: the same services, metric names and labels. With it, an
investigation runs end to end against fixtures ([ADR 0014](../../adr/0014-fixture-datasources.md),
[ADR 0016](../../adr/0016-investigation-init-phase.md)). The [shop](../shop/README.md) manifest
remains the worked example of ADR 0015; no fixture data exists for it.

```bash
HEIMDALL_MANIFEST=.docs/manifests/checkout/manifest.yaml \
PROMETHEUS_DATASOURCE_TYPE=fixture LOKI_DATASOURCE_TYPE=fixture TEMPO_DATASOURCE_TYPE=fixture \
TELEMETRY_FIXTURE_SCENARIO=error-burst-30s \
heimdall investigate "checkouts are not working" --since 30s
```

## The system

The browser posts a cart to `checkout`, which reserves stock in `inventory`, records the order in
`orders-pg` and charges the card through `payments`, which calls an external provider.
`inventory` reads through a soft `stock-cache`. A batch job, `orders-reconcile`, writes to the
same `orders` table.

| Kind | Resources |
|---|---|
| `System` | `storefront`, environment `prod` |
| `Component` | `web`, `checkout`, `payments`, `inventory`, `stock-cache`, `payment-provider`, `orders-pg`, `orders-reconcile` |
| `Functionality` | `checkout` |
| `Flow` | `place-order`: 5 sync steps, trace context propagated |

It compiles to 37 vertices and 44 edges, with 15 indicators: 3 declared, 12 derived.

## What the model is shown

The level-0 index, the only part of the manifest the classification call sees:

```text
system storefront · env prod — Web checkout with stock reservation and card payments
functionality:checkout — Customers pay for their cart and an order is placed | kpi checkout/http_server_request_duration_seconds ~baseline
  flow:place-order  sync: web/checkout-api POST /api/checkout ▸ checkout/reserve-stock POST /reserve ▸ checkout/orders-db UPDATE orders ▸ checkout/charge POST /charges ▸ payments/provider POST — The browser submits the cart; checkout reserves stock, records the order and charges the card
component:web  frontend — The storefront in the browser; emits no telemetry of its own → checkout http sync hard
component:checkout  service → inventory http sync hard · orders-pg sql sync hard · payments http sync hard
component:payments  service → payment-provider http sync hard
component:inventory  service → stock-cache redis sync soft
component:stock-cache  cache redis — Stock levels cached in front of inventory's own database
component:payment-provider  vendor — External card processor at api.stripe.com; observed only through payments' client metrics
component:orders-pg  datastore postgresql
component:orders-reconcile  worker — Periodic batch job reconciling orders against payments → orders-pg sql sync hard
not on any flow: dependency:inventory/stock-cache, dependency:orders-reconcile/orders-db
```

"Checkouts are not working" is expected to land on `functionality:checkout`. `--entry
functionality:checkout` skips the model and gives the same scope and plan, with every role checked.

## Scope

From `functionality:checkout`, with the default hop budget of 1:

- **Suspect:** `place-order`, with all five steps, their dependencies and the six components they join.
- **Neighbour:** `inventory/stock-cache` and `stock-cache`. The dependency is soft and on no step, and it is kept.
- **Contention:** `orders-reconcile/orders-db` and `orders-reconcile`, the other writer to `orders-pg`.
- **Ruled out:** nothing; the system is small enough to fit the budget.
- **Blind spots:** `web`, `payment-provider` and `stock-cache` emit no telemetry; `orders-reconcile`
  has logs but no indicator.

## Walks

### `error-burst-30s`: "checkouts are not working"

1. **Confirm.** The `checkout` KPI dips about 25 seconds before the anchor. The p99 rises but stays
   under the 1s SLO: the symptom is errors, not latency.
2. **Localise.** Steps 1 (`POST /api/checkout`), 4 (`POST /charges`) and 5 (`payments → provider`)
   show errors; 2 and 3 are healthy. The flow is sync, so the deepest failing hop is where the fault
   starts: step 5.
3. **Explain.** Step 5's target, `payment-provider`, is a blind spot and `payments` declares no
   saturation. The explanation has to come from evidence.
4. **Corroborate.** `payments` error logs for `POST` show the provider's `502 Bad Gateway`, and
   its error spans end at `POST /v1/payment_intents`. Since `payment-provider` is a blind spot, the
   conclusion rests on the caller's view of the provider, not on the provider's own telemetry.

### `increased-latency-1`: "checkout is slow"

1. **Confirm.** The `place-order` p99 SLO (≤ 1s) is breached; the KPI barely moves.
2. **Localise.** Steps 1 and 3 (`UPDATE orders`) are slow; `inventory` and `payments` are
   healthy. The deepest slow hop is step 3.
3. **Explain.** Behind step 3, `orders-pg` shows a transaction over the 30s threshold and lock
   counts climbing. `checkout`'s pool is saturated: all 50 connections are in use and requests
   are queueing.
4. **Corroborate.** `orders-reconcile` shares `orders-pg` and has no indicator, so the plan reads
   its logs. They show the batch job's long transaction on `orders`, the cause.

## Coverage findings

- `payment-provider` is visible only through `payments`' client metrics.
- `orders-reconcile` has no metrics, so contention on `orders-pg` can only be proven from logs.
- `inventory`'s own PostgreSQL database, visible in the fixture traces, is not modelled.
