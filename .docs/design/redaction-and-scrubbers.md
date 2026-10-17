# Redaction and scrubbers

- **Status:** Final. Every rule is pinned by the specs [below](#pinned-by), delivered with
  [story 0018-02](../stories/0018-investigation-execution/02-logs-and-traces-evidence.md).
- **Decided in:** [ADR 0008](../adr/0008-egress-allowlist-and-scrub.md),
  [ADR 0018](../adr/0018-investigation-execution-on-the-agent-runtime.md), Queries and redaction

What may leave for the model, and how that is enforced and made visible. Everything on this page
runs in `libs/telemetry`, before a log line or a span reaches anything else.

## The two stages

```
Loki / Tempo ─▶ connector (raw, internal to libs/telemetry)
   ─▶ parse ─▶ 1. allowlist: drop every unmapped field ─▶ 2. cap, then scrub what is left
   ─▶ RedactedText records ─▶ LogsSource / TracesSource ─▶ evidence ─▶ agent
                       └─▶ counts: telemetry.redact span, heimdall.redaction.* counters, report
```

1. **Allowlist (deny by default).** A field reaches the model only when someone mapped it. A new
   log field, or a span attribute nobody anticipated, cannot leak.
2. **Scrubbing.** An allowed field can still carry a secret inside it: a token in a message, a
   password in a DSN. Every allowed value is scrubbed.

The order matters. A scrubber never sees a field the allowlist dropped, and a dropped field is
counted, not scrubbed. Each value of a record is a branded `RedactedText`, and only the `Redactor`
creates one, so code downstream cannot be handed unredacted text by mistake. The raw connectors
are not exported from `@heimdall/telemetry`. A guard spec fails if anything outside the library
reaches into them (ADR 0008, the amendment closed).

## The allowlist

**Logs: the manifest's `telemetry.logs.fields`** (raw key → meaning). Each line is parsed first:

| A line that is | Reads as |
|---|---|
| a JSON object | its keys, nested ones dotted (`http.status`) to three levels; deeper values as JSON text |
| logfmt: at least two `key=value` pairs, and at least as many pairs as other words | its pairs, quoted values unquoted |
| anything else | **unstructured: the whole line is the `message`** |

Only mapped keys survive, renamed to their meaning (`msg` → `message`). Stream labels never leave;
the component already names the stream. An unstructured line (Postgres' `LOG:  process 48211 …`)
has nothing to map, so it is all message, and that is why scrubbing matters most there.

**Spans: a built-in list of OpenTelemetry semantic conventions** that name an operation, never its
payload:

| Kept | Never kept |
|---|---|
| `service.name`, `http.request.method`, `http.route`, `http.response.status_code`, `url.scheme`, `server.address`, `server.port` | `db.query.text` (the statement) |
| `rpc.system`, `rpc.service`, `rpc.method` | `url.full`, `url.path`, `url.query` |
| `db.system`, `db.system.name`, `db.namespace`, `db.operation.name`, `db.collection.name`, `db.response.status_code` | `user_agent.original`, `enduser.*`, `client.address` |
| `messaging.system`, `messaging.operation.type`, `messaging.destination.name`, `messaging.consumer.group.name` | `exception.stacktrace` |
| `error.type`; of an `exception` event, `exception.type` and `exception.message` | every other event, and resource attributes except `service.name` |

Span name, kind, duration and status code are kept. The span name and the status message are
scrubbed like any value.

## The length cap

A value longer than **2,048 characters** is cut at its last whitespace before the cap, and `…` is
appended. Two reasons:
- **The cost of every pattern is bounded.**
- **A token split by the cut is dropped, not half-kept.** A half token is a fragment no scrubber
  would recognise.

After scrubbing, a log example's fields are cut again to 300 characters for the agent.

## The scrubbers

They run in this order: larger structures first, so a token inside them is replaced once, as the
whole. Every match becomes `[REDACTED:<scrubber>]`.

| # | Scrubber | Catches | Becomes | Known miss | Known false positive |
|---|---|---|---|---|---|
| 1 | `privateKey` | a PEM `-----BEGIN … PRIVATE KEY-----` block, to its END line, or to the end of a cut value | `[REDACTED:privateKey]` | a key without PEM armour (a bare base64 blob) | – |
| 2 | `connectionString` | the userinfo of `scheme://user:pass@host`; `password=`, `passwd=`, `pwd=` (also `:` and `"password":`) | `postgres://[REDACTED:connectionString]@orders-pg…`, keeping scheme and host | an Oracle-style `scott/tiger@orcl`; a password with an unescaped `@` | – |
| 3 | `bearerToken` | `Bearer <8+ token characters>`, any case | `Bearer [REDACTED:bearerToken]` | `Basic` credentials | – |
| 4 | `jwt` | three base64url segments starting `eyJ` | `[REDACTED:jwt]` | a JWT split across lines | – |
| 5 | `awsAccessKey` | `AKIA`, `ASIA`, `ABIA`, `ACCA` and 16 more characters | `[REDACTED:awsAccessKey]` | the 40-character secret access key | – |
| 6 | `email` | `local@domain.tld` | `[REDACTED:email]` | `jane at example dot com` | `git@github.com`, and `user@host` in a URI without a password |

`scrubbers` in the config turns them on one by one; all are on when the block is left out
(ADR 0008: opting out must be deliberate). The bearer header runs before the JWT it usually
carries, so `Authorization: Bearer eyJ…` counts as one `bearerToken` match.

## Additional patterns

`redaction.additionalPatterns` adds `{ name, pattern }` scrubbers after the built-ins, each
replaced with `[REDACTED:<name>]`. They are checked when the config loads; a failure is
`CONFIG_INVALID`, naming the pattern and the rule:

| Rule | Why |
|---|---|
| The name starts with a lowercase letter, has at most 32 letters, digits or `-`, is unique, and is not a built-in scrubber's name | It becomes the replacement token and a counter attribute; it must not pass for another scrubber |
| The pattern compiles as a JavaScript regular expression | It is compiled with the `g` flag and nothing else |
| At most 256 characters | Bounds compile and match cost |
| It does not match the empty string | It would replace everything with nothing |
| No backreferences (`\1`, `\k<name>`) | They make matching exponential in general |
| No repeated group that holds a quantifier or an alternation: `(a+)+`, `(a\|ab)*`, `((a\|b)c)+` | Nested repetition is where catastrophic backtracking lives. Exact repetition, `(?:-[a-z]{4}){3}`, is allowed |

The check is static: a pattern is refused at load rather than stalling a run on the first
unlucky line. The built-in scrubbers pass the same check. Together with the length cap, no pattern
can spend more than a bounded time on one value. A zero-length match is never replaced.

## Observability

All counts, never values: no matched text, no field value, and no field name ever becomes an
attribute (ADR 0008, ADR 0017's content policy).

| Signal | Attributes | What it says |
|---|---|---|
| `heimdall.redaction.records` (counter) | `heimdall.telemetry.signal` | Log lines or spans read |
| `heimdall.redaction.fields_dropped` (counter) | `heimdall.telemetry.signal`, `heimdall.component` | Fields and attributes the allowlist dropped |
| `heimdall.redaction.matches` (counter) | `heimdall.telemetry.signal`, `heimdall.redaction.scrubber` | Secrets replaced, per scrubber |
| `telemetry.redact` span, one per batch | the same counts, `heimdall.redaction.matches.<scrubber>`, `heimdall.redaction.truncated` | One query's redaction |
| `telemetry.query` span | the query; **line-filter literals masked** as `"<filter>"` | Literals can come from log content or a tool call |

Each evidence result the agent receives carries `redaction`: records, fields dropped, values cut,
and matches per scrubber. The local report (text and `--json`) adds **the names of the dropped
fields** per subject, at most 50. It is the only place they appear, so whoever tunes the manifest
can see what never left.

**Reading over-redaction.** ADR 0008's "hard" consequence is that too much redaction degrades
conclusions quietly. Watch for:
- a high `fields_dropped` for a component, with a field in the report's dropped list that the
  conclusion needed (e.g. `tx_open_seconds` for a long transaction)
- many `matches` from one scrubber on one component: a false positive eating real evidence
  (`email` on `user@host` URIs)
- the agent saying the evidence it needs was dropped. The prompt asks it to say so rather than
  guess.

## Tuning

- **Widen the allowlist in the manifest, one field at a time.** Map the field to a meaning. The
  checkout reference maps `error`, `table`, `operation`, `duration_ms` and `pool` for checkout,
  and `table`, `isolation` and `tx_open_seconds` for `orders-reconcile`. It deliberately leaves
  `dsn`, `customer` and `authorization` unmapped.
- **Treat widening as a decision.** Record why in the manifest's history or an ADR, not as a
  quiet config tweak (ADR 0008).
- **Add an `additionalPatterns` entry** for an organisation's own token shapes (`ik_…`, `sk_live_…`)
  rather than leaving a field unmapped that is otherwise useful.

## Pinned by

| Spec | Rules |
|---|---|
| `libs/config/src/redaction/pattern-safety.spec.ts` | Every rule of [Additional patterns](#additional-patterns) |
| `libs/config/src/config.loader.spec.ts` | A safe pattern loads; an expensive, invalid or badly named one, a duplicate, or a built-in name fails with `CONFIG_INVALID` |
| `libs/telemetry/src/redaction/scrubbers.spec.ts` | Each row of [The scrubbers](#the-scrubbers): the hit, the known miss and a clean value; email's known false positive; the order; the built-ins pass the pattern rules |
| `libs/telemetry/src/redaction/redactor.spec.ts` | Additional patterns and their tokens, enabled scrubbers only, the [length cap](#the-length-cap), an unterminated private key |
| `libs/telemetry/src/redaction/log-line.parser.spec.ts` | JSON, logfmt and unstructured lines |
| `libs/telemetry/src/source/logs.source.spec.ts` | The allowlist on the fixture, planted secrets in mapped fields scrubbed, unstructured lines as messages, and the span and counters counting exactly, with no value or dropped name exported |
| `libs/telemetry/src/source/traces.source.spec.ts` | The span allowlist: `db.query.text` dropped and named in the summary, a scrubbed status message |
| `libs/telemetry/src/egress.guard.spec.ts` | Only the redacting root is exported; nothing outside `libs/telemetry` imports its connectors or fixtures |
| `libs/investigation/src/execution/investigation-execution.e2e.spec.ts` | With the secret-bearing fields mapped, every planted secret is scrubbed before any request to the model; with the reference manifest, dropped fields are named in the report only |
