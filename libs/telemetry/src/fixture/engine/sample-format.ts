const MILLIS_PER_SECOND = 1000;
const SIGNIFICANT_DIGITS = 6;

/** Prometheus and Loki sample wire form: `[unixSeconds, "value"]`, infinities spelled the Go way. */
export function toWireSample(timestampMs: number, value: number): [number, string] {
  return [timestampMs / MILLIS_PER_SECOND, formatSampleValue(value)];
}

export function formatSampleValue(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '+Inf' : '-Inf';
  }
  // Real samples carry full float noise; six significant digits reads the same and costs fewer tokens.
  return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
}
