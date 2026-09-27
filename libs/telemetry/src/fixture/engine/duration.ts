export enum DurationUnit {
  Millisecond = 'ms',
  Second = 's',
  Minute = 'm',
  Hour = 'h',
  Day = 'd',
  Week = 'w',
}

const UNIT_MILLIS: Readonly<Record<DurationUnit, number>> = {
  [DurationUnit.Millisecond]: 1,
  [DurationUnit.Second]: 1_000,
  [DurationUnit.Minute]: 60_000,
  [DurationUnit.Hour]: 3_600_000,
  [DurationUnit.Day]: 86_400_000,
  [DurationUnit.Week]: 604_800_000,
};

/** Prometheus-style: `30s`, `1h30m`, `2d`. `ms` is listed first so `5ms` is not read as minutes. */
export const DURATION_PATTERN = /^(?:\d+(?:ms|s|m|h|d|w))+$/;
const DURATION_PART = /(\d+)(ms|s|m|h|d|w)/g;

/** Milliseconds, or `undefined` when `value` is not a duration. */
export function parseDuration(value: string): number | undefined {
  if (!DURATION_PATTERN.test(value)) {
    return undefined;
  }
  let total = 0;

  for (const [, amount, unit] of value.matchAll(DURATION_PART)) {
    total += Number(amount) * UNIT_MILLIS[unit as DurationUnit];
  }
  return total;
}
