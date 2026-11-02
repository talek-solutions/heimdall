import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { IMetricPoint } from '@heimdall/telemetry';
import type { IDeviation } from './deviation.calculator';
import { DeviationDirection, PreliminarySignal, ProfileShape, ProfileState } from './health.enums';
import { PROFILE_BUCKETS, ProfileSummariser } from './profile.summariser';

const summariser = new ProfileSummariser({ z: 3.5, minRun: 2, minEffect: 0.1 });
const WINDOW = { start: new Date(0), end: new Date(PROFILE_BUCKETS * 60_000) };

/** One point per bucket, in the middle of it. */
function perBucket(values: readonly number[]): IMetricPoint[] {
  return values.map((value, index) => ({ timestampMs: index * 60_000 + 30_000, value }));
}

function deviation(direction: DeviationDirection, median = 10, spread = 1): IDeviation {
  return {
    signal: PreliminarySignal.Anomalous,
    coverage: 1,
    baseline: { median, spread },
    peak: { value: 0, timestampMs: 0, z: 10, effect: 1, direction },
    longestRun: 2,
    onsetMs: 0,
  };
}

const UP = deviation(DeviationDirection.Up);

describe('ProfileSummariser: the shape and state of an excursion', () => {
  it('reads a jump that stays up as a step, ongoing', () => {
    const profile = summariser.summarise(
      perBucket([10, 10, 10, 10, 10, 10, 60, 100, 100, 100, 100, 100]),
      WINDOW,
      UP,
    );

    assert.equal(profile?.shape, ProfileShape.Step);
    assert.equal(profile?.state, ProfileState.Ongoing);
    assert.equal(profile?.last, 100);
  });

  it('reads a climb over several buckets as a ramp', () => {
    const profile = summariser.summarise(
      perBucket([10, 10, 10, 10, 10, 20, 35, 50, 65, 80, 95, 110]),
      WINDOW,
      UP,
    );

    assert.equal(profile?.shape, ProfileShape.Ramp);
    assert.equal(profile?.state, ProfileState.Ongoing);
  });

  it('reads a short excursion that is back at the baseline as a spike, recovered', () => {
    const profile = summariser.summarise(
      perBucket([10, 10, 10, 10, 100, 100, 10, 10, 10, 10, 10, 10]),
      WINDOW,
      UP,
    );

    assert.equal(profile?.shape, ProfileShape.Spike);
    assert.equal(profile?.state, ProfileState.Recovered);
  });

  it('does not call a short excursion still at its peak a spike: it may only have started', () => {
    const profile = summariser.summarise(
      perBucket([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 100]),
      WINDOW,
      UP,
    );

    assert.equal(profile?.shape, ProfileShape.Step);
    assert.equal(profile?.state, ProfileState.Ongoing);
  });

  it('calls an excursion recovering while it still deviates but has left its peak', () => {
    const profile = summariser.summarise(
      perBucket([10, 10, 10, 100, 100, 100, 100, 100, 60, 50, 40, 30]),
      WINDOW,
      UP,
    );

    assert.equal(profile?.shape, ProfileShape.Step);
    assert.equal(profile?.state, ProfileState.Recovering);
  });

  it('keeps the worst value of a bucket, so a burst shorter than a bucket still shows', () => {
    const points = [
      ...perBucket(Array.from({ length: PROFILE_BUCKETS }, () => 10)),
      { timestampMs: 4 * 60_000 + 5_000, value: 100 },
    ];
    const profile = summariser.summarise(points, WINDOW, UP);

    assert.equal(profile?.points[4], 100);
    assert.equal(profile?.shape, ProfileShape.Spike);
  });

  it('follows a drop with the lowest value of each bucket', () => {
    const points = [
      ...perBucket([100, 100, 100, 100, 100, 100, 60, 50, 50, 50, 50, 50]),
      { timestampMs: 2 * 60_000 + 10_000, value: 99 },
    ];
    const profile = summariser.summarise(
      points,
      WINDOW,
      deviation(DeviationDirection.Down, 100, 1),
    );

    assert.equal(profile?.points[2], 99);
    assert.equal(profile?.shape, ProfileShape.Step);
    assert.equal(profile?.state, ProfileState.Ongoing);
  });

  it('calls a window that never deviates flat, with no state', () => {
    const profile = summariser.summarise(
      perBucket([10, 10.5, 9.5, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
      WINDOW,
      UP,
    );

    assert.equal(profile?.shape, ProfileShape.Flat);
    assert.equal(profile?.state, null);
  });

  it('needs the effect as well as the z-score, as the deviation calculator does', () => {
    // A tight baseline makes a 5% move a large z, but not an effect of 10%.
    const profile = summariser.summarise(
      perBucket([10, 10, 10, 10, 10, 10, 10.5, 10.5, 10.5, 10.5, 10.5, 10.5]),
      WINDOW,
      deviation(DeviationDirection.Up, 10, 0.01),
    );

    assert.equal(profile?.shape, ProfileShape.Flat);
  });

  it('leaves empty buckets empty and reads the state from the last bucket with data', () => {
    const points = perBucket([10, 10, 10, 10, 100, 100, 100, 100, 100, 100, 100, 100]).slice(0, 9);
    const profile = summariser.summarise(points, WINDOW, UP);

    assert.deepEqual(profile?.points.slice(9), [null, null, null]);
    assert.equal(profile?.state, ProfileState.Ongoing);
  });

  it('spans the window in twelve buckets and counts the end point in the last one', () => {
    const points = [{ timestampMs: WINDOW.end.getTime(), value: 42 }];
    const profile = summariser.summarise(points, WINDOW, UP);

    assert.equal(profile?.points.length, PROFILE_BUCKETS);
    assert.equal(profile?.bucketSeconds, 60);
    assert.equal(profile?.points.at(-1), 42);
    assert.equal(profile?.last, 42);
  });

  it('has nothing to say without a baseline', () => {
    const profile = summariser.summarise(perBucket([10, 20]), WINDOW, {
      ...UP,
      signal: PreliminarySignal.NoData,
      baseline: undefined,
      peak: undefined,
    });

    assert.equal(profile, undefined);
  });
});
