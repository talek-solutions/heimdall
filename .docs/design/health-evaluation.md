# Health evaluation

- **Status:** Final. The rules are calibrated against the fixture scenarios and pinned by the
  specs [below](#pinned-by), delivered with
  [story 0018-01](../stories/0018-investigation-execution/01-metrics-investigation.md).
- **Decided in:** [ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md), Hybrid
  verdicts

How code turns a metric series into the numbers the agent reasons over. Code computes everything
on this page. The model never sees a raw series, only the result of these rules.

## Where it sits

```
run_checks / check_indicator ─▶ compile query ─▶ TelemetrySource ─▶ window + baseline series
     ─▶ DeviationCalculator ─▶ PreliminarySignal ─┐
     ─▶ ExpectationEvaluator ─▶ objective verdict ┴▶ check result ─▶ agent
```

Who owns the verdict depends on the indicator's expectation:

| Expectation | Verdict decided by | Code returns |
|---|---|---|
| `slo`, `threshold`, `nonZero` | code | an objective verdict (`met`, `breached`, `no-data`) and the deviation statistics |
| `baseline` | model | the deviation statistics and a preliminary signal; the model gives the verdict and cites the numbers |

An objective verdict cannot be overridden: the conclusion validator rejects a conclusion that
does (ADR 0018). The statistics are computed for every expectation. A p99 can be well within its
SLO and still far off its baseline, and the agent should see both.

## Inputs

| Input | Rule |
|---|---|
| **Window** | `[end − lookback, end]`, where `end` is now (or the fixture anchor) and `lookback` is `--since` (default 60m). The agent may ask for a narrower window (see [Zooming in](#zooming-in)) |
| **Baseline** | The window of the same length right before it (ADR 0016, Intake) |
| **Step** | `max(step floor, window ÷ 240)`, so a window holds about 240 points. A 60m window gives 15s; a 2m window gives the floor (1s) |
| **Rate window** | `max(60s, 4 × step)` for every `rate()` in a template, so each point covers at least 4 samples at the step |
| **Coverage** | Points present in the window ÷ points expected (`window ÷ step + 1`) |
| **Role** | One query per role of the indicator. A histogram serving throughput, errors and latency gives three series, evaluated separately |

**What a KPI measures.** For a `kpi` on a metric that has a `statusCode` or `outcome` label,
the template counts successful requests only (`statusCode !~ "5.."`, `outcome != "error"`).
Failed requests are still requests. Counting them, `error-burst-30s` keeps a flat checkout rate
while a fifth of checkouts fail (the `tot_2` row below).

## Definitions

For a baseline series `b` and a window series `x₁ … xₙ`:

| Quantity | Formula |
|---|---|
| Baseline median | `m = median(b)` |
| Spread | `s = max(1.4826 · median(|b − m|), 0.01 · |m|, ε)`. The first term is the scaled MAD, robust to the spikes a baseline can hold. The 1% floor keeps a flat baseline from turning every wobble into a large z. `ε = 1e-12` covers an all-zero baseline |
| Robust z | `zᵢ = (xᵢ − m) / s` |
| Effect | `eᵢ = (xᵢ − m) / |m|`. When `m = 0`, a zero point has effect 0 and any other point counts as infinite |
| Bad direction | **Up** for `errors`, `latency`, `saturation` and `lag`. **Both ways** for `throughput` and `kpi`: a drop is a symptom, a surge can be a cause. The result says which way the peak went |
| Deviating point | A point whose z, in the bad direction, is at least `k`, **and** whose effect, in the same direction, is at least the minimum effect |
| Qualifying run | At least `minRun` deviating points in a row |
| Onset | The timestamp of the first point of the first qualifying run |
| Peak | The point with the largest z in the bad direction |

Both conditions must hold for a point to deviate:
- **z alone is not enough.** A tiny change on a quiet series gives a large z.
- **Effect alone is not enough.** A noisy series moves 20% on its own.

## Preliminary signal

Evaluated in this order; the first match wins.

| # | Signal | When |
|---|---|---|
| 1 | `no-data` | Coverage is below 50%, or the baseline has no point |
| 2 | `anomalous` | At least one qualifying run |
| 3 | `borderline` | At least one deviating point, but no qualifying run |
| 4 | `normal` | Otherwise |

**No data is never healthy.** A check with no data stays `no-data` in every report, and when a
step with no data sits deeper than the deepest unhealthy step, the origin is reported as
uncertain (ADR 0018).

## Objective verdicts

`ExpectationEvaluator` compares each point with the indicator's bounds and uses the same run
rule, so a single-point blip never breaches anything.

| Expectation | Breached when |
|---|---|
| `slo` with a percentile (`p50`, `p90`, `p95`, `p99`) | The template computes that quantile. At least `minRun` consecutive points are above the bound (percentiles are upper bounds) |
| `slo` / `threshold` with `max` | At least `minRun` consecutive points are above `max` |
| `slo` / `threshold` with `min` | At least `minRun` consecutive points are below `min` |
| `nonZero` | At least `minRun` consecutive points are zero |

- **`no-data`**: coverage below 50%.
- **`met`**: otherwise.
- **Breach onset**: the first point of the first breaching run.
- **Several bounds** (e.g. `p95` and `max`): each is checked, and any breach breaches.

## Zooming in

A long window at a coarse step can miss a short burst, or catch it on a single point. To avoid
that, the result carries a `zoom` hint when either:
- the signal is `borderline`, or
- the longest qualifying run is shorter than 4 points.

The hint is a 4-minute window centred on the peak and clipped to the window's end. Asking for it
(`run_checks` with that window) shrinks the step to the floor. No hint is offered when the step is
already at the floor, since zooming would not shrink it. In `error-burst-30s` this is how
the burst becomes clear (rows `p99_60` → `p99_2` below).

## Defaults

| Setting | Default | Variable |
|---|---|---|
| z threshold `k` | 3.5 | `INVESTIGATION_DEVIATION_Z` |
| Minimum run `minRun` | 2 points | `INVESTIGATION_DEVIATION_MIN_RUN` |
| Minimum effect | 10% | `INVESTIGATION_DEVIATION_MIN_EFFECT_PERCENT` |
| Step floor | 1s | `INVESTIGATION_STEP_FLOOR_SECONDS` |
| Spread floor | 1% of the baseline median | constant |
| Minimum coverage | 50% | constant |
| Points per window | 240 | constant |
| Zoom span | 4 minutes | constant |

`k = 3.5` with 240 points still lets about one in ten normal series show a borderline point by
chance, which is what `healthy-baseline` does. `minRun = 2` is what keeps chance points from
becoming anomalous.

## Worked examples

All three walks of the checkout README, at anchor `2026-10-17T08:00:00Z`, with times relative to
the anchor:
- **`…_60` rows:** a 60m window at a 15s step.
- **`…_2` rows:** a 2m window at a 1s step.
- **Series:**
  - `err` is checkout's 5xx ratio and `p99` its latency.
  - `tot` is all checkout requests. `rps` is 2xx requests only, which is what the KPI measures.

| Scenario | Series | Signal | Baseline median | Peak | At | z | Effect | Run | Onset |
|---|---|---|---|---|---|---|---|---|---|
| `error-burst-30s` | `err_60` | anomalous | 0.00123 | 0.0502 | −15s | 141.5 | +3983% | 2 | −15s |
| | `err_2` | anomalous | 0.00117 | 0.190 | −24s | 637.7 | +16168% | 25 | −24s |
| | `p99_60` | borderline | 0.181s | 0.281s | −15s | 7.5 | +55% | 1 | — |
| | `p99_2` | anomalous | 0.178s | 0.652s | −24s | 43.4 | +267% | 14 | −24s |
| | `rps_2` | anomalous | 118.2/s | 94.7/s | −24s | 5.8 | −20% | 4 | −24s |
| | `tot_2` | normal | 118.2/s | 126.9/s | −13s | 2.2 | +7% | 0 | — |
| `increased-latency-1` | `p99_60` | anomalous | 0.166s | 2.24s | −45s | 173.9 | +1253% | 120 | −29m45s |
| | `err_60` | anomalous | 0.00120 | 0.0636 | −9m30s | 192.6 | +5184% | 112 | −27m45s |
| | `rps_60` | anomalous | 109.6/s | 80.0/s | −4m15s | 9.3 | −27% | 91 | −23m45s |
| `healthy-baseline` | `err_60` | borderline | 0.00117 | 0.00225 | −22m15s | 4.1 | +93% | 1 | — |
| | `p99_60` | normal | 0.167s | 0.200s | −38m | 2.9 | +20% | 0 | — |
| | `rps_60` | normal | 109.6/s | 121.1/s | −45s | 2.9 | +11% | 0 | — |

What the table shows:

- **`error-burst-30s`, zoomed in, matches its walk.** The errors, the p99 and the KPI all have
  their onset at −24s. The p99 peaks at 0.65s, so the `place-order` SLO (p99 ≤ 1s) is `met` even
  though the series is anomalous: the symptom is errors, not latency.
- **At 60m/15s the burst barely shows.** The error ratio qualifies on exactly `minRun` points with
  a 9-second-late onset, and the p99 is only borderline. The zoom hint exists for this.
- **`increased-latency-1` matches its walk.** The p99 onset (−29m45s) and the 504 onset
  (−27m45s) match the scenario (climbing from T−30m, 504s from T−28m), and the SLO is
  `breached`. The KPI falls 27% from about T−24m. The README walk says it "barely moves"; the
  walk is corrected with story 0018-01.
- **`healthy-baseline` stays healthy.** It has one chance borderline point and nothing anomalous.

## What the agent receives

One result per role, inside the `run_checks` or `check_indicator` tool result. It carries no
query text and no matchers (ADR 0015, level 2):

```jsonc
{
  "check": "c3",
  "indicator": "indicator:step:place-order#1@1",
  "role": "errors",
  "expectation": "baseline",
  "verdict": null,                               // "met" | "breached" | "no-data" for objective kinds
  "signal": "anomalous",                         // the preliminary signal
  "direction": "up",
  "unit": "1",
  "window": { "start": "…T07:58:00Z", "end": "…T08:00:00Z", "stepSeconds": 1 },
  "baseline": { "median": 0.00117, "spread": 0.00030 },
  "peak": { "value": 0.190, "at": "…T07:59:36Z", "z": 637.7, "effectPercent": 16168 },
  "longestRun": 25,
  "onset": "…T07:59:36Z",
  "coverage": 1.0,
  "zoom": null                                   // { "start", "end" } when a narrower window would help
}
```

## Known limits

- **The baseline is the window before.** A slow drift, a diurnal swing or an incident longer than
  the window is compared with itself and can look normal. In `memory-leak-2d` the heap climbs for
  six hours, so a 60m window sits on a baseline that is already rising. Widen `--since` for slow
  failures.
- **Production smears bursts.** A 30-second burst inside a 60s `rate()` window shows at about half
  its height in real Prometheus. The fixtures return curve values without that smoothing, so they
  show sharper peaks than production will.
- **The fixtures route queries rather than evaluating them** (ADR 0014), except a bare `sum(…)` or
  `max(…)` around the whole query, which they combine as Prometheus would (ADR 0014, amendment).
  When a backend still returns several series for one query, the runner evaluates each and reports
  the most deviant.
- **Low traffic.** A ratio over a near-zero rate jumps or goes missing. A missing point lowers
  coverage, and below 50% the check reports `no-data` instead of noise.
- **A one-point spike is never anomalous.** A genuine one-scrape blip is reported as `borderline`,
  with a zoom hint.

## Pinned by

Each spec is named after the rule it pins. All live in `libs/investigation/src/execution/`.

| Spec | Rules |
|---|---|
| `health/deviation.calculator.spec.ts` | Every rule of [Definitions](#definitions) and [Preliminary signal](#preliminary-signal), and every row of [Worked examples](#worked-examples), queried from the fixtures through the real compiler and source |
| `health/expectation.evaluator.spec.ts` | Each bound kind, the run rule for breaches, breach onset, several bounds, `no-data` |
| `queries/step-policy.spec.ts` | Step, rate window, expected points, the zoom hint and its floor |
| `queries/promql.compiler.spec.ts` | KPI = successful requests, the latency quantile from the SLO |
| `investigation-execution.e2e.spec.ts` | The `error-burst-30s` walk end to end, `healthy-baseline` concluding no-signal |
