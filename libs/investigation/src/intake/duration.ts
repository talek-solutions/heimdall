const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};
const DURATION = /^([1-9]\d*)([smhd])$/;

/** `30m` → 1 800 000; `undefined` when the text is not a positive duration. */
export function parseDuration(text: string): number | undefined {
  const match = DURATION.exec(text.trim());
  const unit = match?.[2];

  return match === null || unit === undefined ? undefined : Number(match[1]) * (UNIT_MS[unit] ?? 0);
}
