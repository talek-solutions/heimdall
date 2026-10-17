import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { queryWindow, zoomWindow } from './step-policy';

const END = new Date('2026-10-17T08:00:00.000Z');
const minutesBefore = (minutes: number) => new Date(END.getTime() - minutes * 60_000);

describe('step policy (health-evaluation.md, Inputs and Zooming in)', () => {
  it('aims for 240 points a window, at least the floor, with a rate window of four steps or a minute', () => {
    const hour = queryWindow({ start: minutesBefore(60), end: END }, 1);
    const twoMinutes = queryWindow({ start: minutesBefore(2), end: END }, 1);
    const day = queryWindow({ start: minutesBefore(24 * 60), end: END }, 1);

    assert.deepEqual(
      [hour.stepSeconds, hour.rateWindowSeconds, hour.expectedPoints],
      [15, 60, 241],
    );
    assert.deepEqual([twoMinutes.stepSeconds, twoMinutes.expectedPoints], [1, 121]);
    assert.deepEqual([day.stepSeconds, day.rateWindowSeconds], [360, 1440]);
    assert.equal(hour.baselineStart.toISOString(), minutesBefore(120).toISOString());
  });

  it('offers a 4-minute zoom on the peak, clipped to the end, for a borderline or short deviation', () => {
    const hour = queryWindow({ start: minutesBefore(60), end: END }, 1);
    const peak = END.getTime() - 15_000;

    assert.deepEqual(zoomWindow(peak, hour, 1, true, 1), {
      start: new Date(peak - 120_000),
      end: END,
    });
    assert.ok(zoomWindow(peak, hour, 1, false, 2));
    assert.equal(zoomWindow(peak, hour, 1, false, 12), undefined, 'a long run is clear already');
    assert.equal(zoomWindow(peak, hour, 1, false, 0), undefined, 'nothing deviates');
  });

  it('offers no zoom when the step is already at its floor', () => {
    const twoMinutes = queryWindow({ start: minutesBefore(2), end: END }, 1);

    assert.equal(zoomWindow(END.getTime() - 24_000, twoMinutes, 1, true, 1), undefined);
  });
});
