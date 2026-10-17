import type { ITimeWindow } from '../../interfaces';

const POINTS_PER_WINDOW = 240;
const MIN_RATE_WINDOW_SECONDS = 60;
const RATE_WINDOW_STEPS = 4;
const ZOOM_SPAN_MS = 4 * 60_000;
/** A qualifying run shorter than this is worth a closer look. */
const SHORT_RUN = 4;

export interface IQueryWindow {
  readonly start: Date;
  readonly end: Date;
  /** The window of the same length right before `start`. */
  readonly baselineStart: Date;
  readonly stepSeconds: number;
  readonly rateWindowSeconds: number;
  readonly expectedPoints: number;
}

/** `.docs/design/health-evaluation.md`, Inputs: about 240 points per window, floored. */
export function queryWindow(window: ITimeWindow, stepFloorSeconds: number): IQueryWindow {
  const durationMs = window.end.getTime() - window.start.getTime();
  const durationSeconds = durationMs / 1_000;
  const stepSeconds = Math.max(stepFloorSeconds, Math.ceil(durationSeconds / POINTS_PER_WINDOW));

  return {
    start: window.start,
    end: window.end,
    baselineStart: new Date(window.start.getTime() - durationMs),
    stepSeconds,
    rateWindowSeconds: Math.max(MIN_RATE_WINDOW_SECONDS, RATE_WINDOW_STEPS * stepSeconds),
    expectedPoints: Math.floor(durationSeconds / stepSeconds) + 1,
  };
}

/**
 * A 4-minute window centred on the peak and clipped to the window's end, offered when a short or
 * borderline deviation could be clearer at a finer step. `undefined` when the step is already at
 * its floor, since zooming would not shrink it.
 */
export function zoomWindow(
  peakMs: number,
  window: IQueryWindow,
  stepFloorSeconds: number,
  borderline: boolean,
  longestRun: number,
): ITimeWindow | undefined {
  const short = borderline || (longestRun > 0 && longestRun < SHORT_RUN);

  if (!short || window.stepSeconds <= stepFloorSeconds) {
    return undefined;
  }
  return {
    start: new Date(peakMs - ZOOM_SPAN_MS / 2),
    end: new Date(Math.min(peakMs + ZOOM_SPAN_MS / 2, window.end.getTime())),
  };
}
