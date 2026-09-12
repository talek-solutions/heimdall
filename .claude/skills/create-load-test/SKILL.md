---
name: create-load-test
description: >
 Use this skill whenever a user wants to create, write, generate, or set up a load test,
 stress test, performance test, or API benchmark. Triggers include mentions of "load test",
 "stress test", "RPS", "requests per second", "concurrent requests", "latency test", "API
 throughput", "performance benchmark", or asking to test how a server handles load. Also
 trigger when a user wants to measure P95/P99 latency, simulate traffic, or test endpoints
 under pressure. Use this skill even if the user just says "write a test to hammer the API"
 or "I want to see how many requests this can handle."
---

# Create Load Test Skill

This skill creates load testing scripts for APIs and services. Tests are written in the
project's native language, defaulting to **Node.js (v24) with ESM**.

---

## Workflow

### 1. Gather Context

Before writing any code, extract as much as possible from the codebase and conversation:

- **Endpoint**: URL, HTTP method, path params, query params
- **Payload**: required fields, data types, static vs. dynamic values
- **Auth**: headers, tokens, API keys
- **Test type**: ephemeral (default) vs. permanent (not supported — notify user)
- **Load pattern**: flat (default) or load curve (with stages)
- **Load mode**: concurrency (default) or RPS (only if explicitly requested)
- **Target load**: concurrency level or RPS target
- **Termination**: total request count (default: 500) or endless mode (if user says "endless", "constant load", "run forever", etc.)
- **Statistics**: full (default) or lite/light (skip stats)

If critical details are missing (endpoint, payload shape), **ask the user before proceeding**.
Do not guess auth schemes or payload structures — these are high-risk to get wrong.

If the user says **"ask me"**, run a short interview covering all the above points.

---

### 2. Determine Termination Mode

| Mode | Trigger | Behaviour |
|------|---------|-----------|
| **Count** (default) | No explicit cap or duration given | Stop after **500 requests** total (or the number the user specifies) |
| **Endless** | User says "endless", "constant load", "run forever", "keep going", or similar | No request cap — run until Ctrl+C / signal. Focus is on rate and concurrency limit only |

> **Decision rule**: default to 500 requests. Only switch to endless mode on an explicit
> signal from the user. Never infer endless from a high RPS or concurrency number alone.

Duration-based termination (e.g. "run for 2 minutes") is also valid — honour it when stated,
but don't prompt for a duration if the user hasn't mentioned one.

---

### 3. Determine Test Type

| Type | Description |
|------|-------------|
| **Ephemeral** (default) | Runs until request count is reached (or signal in endless mode), then exits cleanly |
| **Permanent** | ❌ Not supported — inform the user |

---

### 3. Determine Load Mode

**Concurrency mode** (default): maintains a fixed number of in-flight requests at all times.
As soon as one request completes, the next is dispatched — throughput is a natural outcome,
not a target. Use this unless the user explicitly asks for RPS-based control.

**RPS mode** (only if explicitly requested): dispatches requests on a fixed schedule
(e.g. 50 requests/second) using a token bucket or interval timer. Concurrency is uncapped
by default but can be given a ceiling to avoid runaway pile-up.

> **Decision rule**: if the user says "X concurrent requests", "N workers", "keep N in-flight",
> or gives no load specification → use **concurrency mode**. Only switch to RPS mode if the
> user explicitly says "N RPS", "N requests per second", or "rate-limited to N/s".

---

### 4. Determine Load Pattern

**Flat test** (default): constant load (concurrency level or RPS) for the full duration.

**Load curve**: stages with configurable duration + intensity. Intensity means concurrency
workers in concurrency mode, or RPS in RPS mode. Example:
```
Stage 1: 0–60s    →  5 workers  (warm-up)
Stage 2: 60–180s  → 20 workers  (sustained)
Stage 3: 180–240s →  2 workers  (cool-down)
```
Prompt the user for stage definitions if they request a load curve but don't specify stages.

---

### 4. Build the Request

Structure the request payload in a clearly readable, maintainable way — separate static
config from dynamic generation:

```js
// ── Static config (easy to update) ──────────────────────────────────────────
const BASE_URL      = 'https://api.example.com';
const ENDPOINT      = '/v1/orders';
const CONCURRENCY   = 20;        // number of in-flight requests at any time
const TOTAL_REQUESTS = 500;      // set to Infinity for endless mode
// const TARGET_RPS = 50;        // uncomment only if RPS mode was requested

// ── Dynamic payload builder ──────────────────────────────────────────────────
function buildPayload() {
  return {
    orderId:   crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    currency:  pick(['EUR', 'USD', 'JPY']),
    amount:    +(Math.random() * 1000).toFixed(2),
  };
}
```

Common dynamic values to include as appropriate:
- UUIDs (`crypto.randomUUID()`)
- Timestamps (`new Date().toISOString()`)
- Random amounts / quantities
- Static enum picks (currencies, statuses, regions)

---

### 5. Core Test Requirements

Every load test must satisfy these unless overridden:

- **Load dispatch** (choose based on mode):
 - *Concurrency mode* (default): run a fixed-size worker pool — each worker loops
   (send request → await response → repeat) until duration expires
 - *RPS mode* (explicit only): use a token bucket or `setInterval` scheduler to fire
   requests at the target rate; optionally cap max in-flight to prevent pile-up
- **Graceful shutdown**: handle `SIGINT` / `SIGTERM` (Ctrl+C) — drain in-flight, then exit
- **Duration-bounded**: stop automatically after configured time
- **Statistics** (skip if "lite"/"light" requested):
 - Latency: P50, P95, P99, min, max
 - Throughput: actual RPS achieved
 - Error rate: % of failed requests
 - HTTP status code distribution
 - Output: histogram or table (default table; histogram if user requests or volume is high)

---

### 6. Output Location

```
<project-root>/
└── .load-tests/
    └── <LOAD_TEST_NAME>/
        ├── index.js        # main test script
        └── README.md       # config summary (see below)
```

Create the directory if it doesn't exist — no user approval needed.
**Never delete load test files without explicit user confirmation.**

---

### 7. README.md Contents

Keep it brief but complete:

- What is being tested (endpoint, protocol)
- Load pattern (flat or curve with stage table)
- What is static vs. dynamically generated in the request
- How to run the test
- How to stop it early

---

### 8. Post-Delivery Summary

After delivering the test, present a summary table in chat:

| Property | Value |
|----------|-------|
| Test name | `name-of-test` |
| Endpoint | `METHOD /path` |
| Load pattern | Flat / Load curve |
| Load mode | Concurrency (N workers) / RPS (N req/s) |
| Termination | 500 requests / N requests / Endless |
| Duration | Xs |
| Statistics | Full / Lite |
| Dynamic fields | list them |

Follow with a **Caveats & Tradeoffs** section noting any deliberate decisions, assumptions,
or simplifications made. If the test has multi-step chaining (e.g., auth → create → query),
diagram the request chain explicitly.

---

## Constraints & Edge Cases

- **Permanent load tests**: not supported. Tell the user and suggest ephemeral with a long duration as an alternative.
- **Lite/light tests**: skip all statistics collection entirely for minimal overhead.
- **Unknown endpoints**: ask the user rather than guessing — wrong URLs fail silently under load.
- **Auth**: never hardcode secrets in files. Use `process.env.TOKEN` with a note in the README.
- **gRPC / WebSocket**: supported in principle — note in the README that additional dependencies may be needed and scaffold accordingly.