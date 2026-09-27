import type { DirectTelemetryBackend } from '../datasource/telemetry-datasource-config.model';

/**
 * Model-written queries are matched against scenario regexes synchronously, so
 * their length is capped before any regex sees them (ReDoS).
 */
export const MAX_MATCHABLE_QUERY_LENGTH = 16_384;

/** Prometheus `web/api/v1`: range queries beyond this many points per series are rejected. */
export const PROMETHEUS_MAX_POINTS_PER_SERIES = 11_000;

/** `.invalid` never resolves (RFC 2606), so a fixture client cannot reach a network by accident. */
export function fixtureBaseUrl(backend: DirectTelemetryBackend): string {
  return `http://${backend}.fixture.invalid`;
}

/** Loki's own defaults and limits (`loghttp`, `validation`). */
export const LOKI_DEFAULT_LIMIT = 100;
export const LOKI_MAX_ENTRIES_LIMIT = 5_000;
/** A range query without `start` looks back this far from `end`. */
export const LOKI_DEFAULT_LOOKBACK_MS = 3_600_000;
/** Without `step`, a metric range query gets about this many points. */
export const LOKI_DEFAULT_STEP_POINTS = 250;

/**
 * Fixture-only: the most lines one Loki query may generate. A rare line filter
 * over days would otherwise render millions; past this, the result is partial.
 */
export const LOKI_MAX_SCANNED_LINES = 500_000;

/** Tempo's own search defaults and limits. */
export const TEMPO_DEFAULT_LIMIT = 20;
export const TEMPO_DEFAULT_SPANS_PER_SPAN_SET = 3;
export const TEMPO_MAX_SEARCH_DURATION_MS = 168 * 3_600_000;
/** Fixture approximation of a search without bounds, which Tempo answers from recent data. */
export const TEMPO_DEFAULT_SEARCH_WINDOW_MS = 3_600_000;

/** Fixture-only: the most traces one search may generate before answering with what it has. */
export const TEMPO_MAX_SCANNED_TRACES = 200_000;
/** Fixture-only: how many seconds back a log line looks for a trace to reference. */
export const TRACE_LOOKBACK_BUCKETS = 10;
