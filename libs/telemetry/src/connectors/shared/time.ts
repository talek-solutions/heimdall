const NANOS_PER_MILLI = 1_000_000n;
const MILLIS_PER_SECOND = 1000;

export function toUnixNanos(date: Date): string {
  return (BigInt(date.getTime()) * NANOS_PER_MILLI).toString();
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / MILLIS_PER_SECOND);
}

export function secondsToMillis(seconds: number): number {
  return Math.round(seconds * MILLIS_PER_SECOND);
}
