import type { IToolInputParse } from '@heimdall/agent';
import type { IInvestigationWindow, ITimeWindow } from '../../interfaces';

const MIN_WINDOW_MS = 60_000;

export type Fields = Record<string, unknown>;

export function object(input: unknown): Fields | undefined {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? (input as Fields)
    : undefined;
}

export function invalid<T>(problem: string): IToolInputParse<T> {
  return { ok: false, problem };
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * A check window: ISO timestamps, at least a minute long, inside what the plan looked at (its
 * window and the baseline before it). `undefined` input means the plan's own window.
 */
export function checkWindow(
  value: unknown,
  plan: IInvestigationWindow,
): ITimeWindow | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const fields = object(value);
  const start = Date.parse(String(fields?.['start']));
  const end = Date.parse(String(fields?.['end']));

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'window needs ISO start and end timestamps';
  }
  if (end - start < MIN_WINDOW_MS) {
    return 'window must be at least a minute long';
  }
  if (start < plan.baseline.start.getTime() || end > plan.end.getTime()) {
    return `window must lie within ${plan.baseline.start.toISOString()} … ${plan.end.toISOString()}`;
  }
  return { start: new Date(start), end: new Date(end) };
}

export const WINDOW_SCHEMA = {
  type: 'object',
  description:
    'Optional narrower window, e.g. the zoom a result suggests. ISO-8601; within the investigation window or its baseline.',
  properties: {
    start: { type: 'string', format: 'date-time' },
    end: { type: 'string', format: 'date-time' },
  },
  required: ['start', 'end'],
} as const;
