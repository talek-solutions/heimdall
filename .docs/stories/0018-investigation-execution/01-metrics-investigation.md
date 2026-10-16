# 0018-01. Metrics investigation

- **Priority:** High
- **Persona:** Software engineer
- **Advances:** [US-001](../../user-stories/US-001-on-demand-investigation.md) items 1 and 2
- **Decided in:** [ADR 0018](../../adr/0018-investigation-execution-on-the-agent-runtime.md)

## Story

As an engineer who reported "checkouts are not working", I want Heimdall to check the metrics the
plan names and tell me which step of the flow is failing and since when, so that I start from the
failing hop instead of a wall of dashboards.

## Items

| # | It can… | Status |
|---|---|---|
| 1 | Resolve the environment's context to its Prometheus source, live or fixture | planned |
| 2 | Read metrics through a `TelemetrySource`, never through the raw connectors | planned |
| 3 | Compile each indicator to PromQL from the metric catalogue: role × metric type, selector labels, owner matchers, environment labels, `query:` override | planned |
| 4 | Choose the step and rate window from the window length, with a floor | planned |
| 5 | Compute deviation statistics and a `PreliminarySignal` per series (`DeviationCalculator`) | planned |
| 6 | Decide SLO, threshold and nonZero verdicts in code (`ExpectationEvaluator`) | planned |
| 7 | Let the agent run checks and graph lookups within the scope, and pruned vertices with a stated reason | planned |
| 8 | Validate the conclusion; send one rejection back, then fail with `INVESTIGATION_CONCLUSION_INVALID` | planned |
| 9 | Run execution from `investigate` unless `--plan-only`; exit 0, 3 or 5 by outcome | planned |
| 10 | Emit `check_completed`, `agent_turn` and `concluded` events, and `telemetry.query` spans | planned |
| 11 | Document the health rules in [`.docs/design/health-evaluation.md`](../../design/health-evaluation.md) | planned |

## Acceptance

- **Queries.** Every indicator of the checkout manifest compiles to a query that reaches a fixture
  series through `selectMatching`: compiler spec.
- **Statistics.** At 1s resolution, the 30-second burst of `error-burst-30s` comes out
  `anomalous`, with its onset inside the burst. `healthy-baseline` stays `normal`:
  `deviation.calculator.spec.ts`.
- **Objective verdicts.** The `place-order` p99 of `error-burst-30s` (0.62s) meets the 1s SLO,
  and `increased-latency-1` breaches it: `expectation.evaluator.spec.ts`.
- **End to end, with a scripted model:**
  - `error-burst-30s` concludes origin `step:place-order#5`, cause `component:payment-provider`,
    exit 0
  - `healthy-baseline` exits 3
  - a starved budget exits 5
- **Health doc.** `health-evaluation.md` is published, and every rule in it names the spec that
  pins it.
- **Real model.** A manual run of the checkout README command reaches the documented walk.

## Notes

- The model never sees a raw series; it sees the statistics the code computed.
- Logs and traces checks are refused with a clear error until
  [0018-02](02-logs-and-traces-evidence.md) lands.
