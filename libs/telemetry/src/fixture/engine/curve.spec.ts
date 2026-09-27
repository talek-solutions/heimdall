import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ModulatedCurve, PhasedCurve, PhaseShape, ReferenceCurve, type ICurveModifiers } from './curve';

const MINUTE = 60_000;
const NO_MODIFIERS: ICurveModifiers = {
  seasonality: undefined,
  noiseStddev: undefined,
  min: undefined,
  max: undefined,
  round: false,
};

describe('PhasedCurve', () => {
  it('holds the baseline before the first phase', () => {
    const curve = new PhasedCurve(10, [
      { shape: PhaseShape.Ramp, atMs: 30 * MINUTE, to: 20, overMs: 10 * MINUTE },
    ]);

    assert.equal(curve.valueAt(-5 * MINUTE), 10);
    assert.equal(curve.valueAt(29 * MINUTE), 10);
  });

  it('ramps linearly, then holds the target', () => {
    const curve = new PhasedCurve(10, [
      { shape: PhaseShape.Ramp, atMs: 30 * MINUTE, to: 20, overMs: 10 * MINUTE },
    ]);

    assert.equal(curve.valueAt(35 * MINUTE), 15);
    assert.equal(curve.valueAt(40 * MINUTE), 20);
    assert.equal(curve.valueAt(90 * MINUTE), 20);
  });

  it('treats a zero-length ramp as a step', () => {
    const curve = new PhasedCurve(0, [{ shape: PhaseShape.Ramp, atMs: MINUTE, to: 1, overMs: 0 }]);

    assert.equal(curve.valueAt(MINUTE - 1), 0);
    assert.equal(curve.valueAt(MINUTE), 1);
  });

  it('starts each phase from the level the previous one reached', () => {
    const curve = new PhasedCurve(100, [
      { shape: PhaseShape.Ramp, atMs: 0, to: 200, overMs: 10 * MINUTE },
      // Interrupts the ramp halfway, at 150.
      { shape: PhaseShape.Ramp, atMs: 5 * MINUTE, to: 50, overMs: 10 * MINUTE },
    ]);

    assert.equal(curve.valueAt(5 * MINUTE), 150);
    assert.equal(curve.valueAt(10 * MINUTE), 100);
    assert.equal(curve.valueAt(15 * MINUTE), 50);
  });

  it('spikes and decays ~95% back within the decay window', () => {
    const curve = new PhasedCurve(1, [
      { shape: PhaseShape.Spike, atMs: MINUTE, to: 11, decayMs: 3 * MINUTE },
    ]);

    assert.equal(curve.valueAt(MINUTE), 11);
    const remaining = (curve.valueAt(4 * MINUTE) - 1) / 10;
    assert.ok(remaining > 0.04 && remaining < 0.06, `remaining ${remaining}`);
  });

  it('repeats a sawtooth until a hold freezes it', () => {
    const curve = new PhasedCurve(300, [
      { shape: PhaseShape.Sawtooth, atMs: 0, to: 1900, periodMs: 60 * MINUTE },
      { shape: PhaseShape.Hold, atMs: 150 * MINUTE },
    ]);

    assert.equal(curve.valueAt(30 * MINUTE), 1100);
    assert.equal(curve.valueAt(60 * MINUTE), 300);
    assert.equal(curve.valueAt(90 * MINUTE), 1100);
    assert.equal(curve.valueAt(150 * MINUTE), 1100);
    assert.equal(curve.valueAt(500 * MINUTE), 1100);
  });
});

describe('ReferenceCurve', () => {
  it('follows its target, scaled', () => {
    const target = new PhasedCurve(0.2, [{ shape: PhaseShape.Ramp, atMs: 0, to: 2, overMs: MINUTE }]);
    const millis = new ReferenceCurve(target, 1000);

    assert.equal(millis.valueAt(-1), 200);
    assert.equal(millis.valueAt(MINUTE), 2000);
  });
});

describe('ModulatedCurve', () => {
  const flat = new PhasedCurve(100, []);

  it('gives an instant one value, whatever else is evaluated around it', () => {
    const curve = new ModulatedCurve(flat, { ...NO_MODIFIERS, noiseStddev: 5 }, 1234, 15_000);
    const instant = 42 * MINUTE + 7_000;
    const first = curve.valueAt(instant);

    for (let offset = -MINUTE; offset <= MINUTE; offset += 1_000) {
      curve.valueAt(instant + offset);
    }
    assert.equal(curve.valueAt(instant), first);
    // Same noise bucket: same value.
    assert.equal(curve.valueAt(42 * MINUTE + 1_000), first);
    assert.notEqual(curve.valueAt(43 * MINUTE), first);
  });

  it('gives different noise to different seeds', () => {
    const one = new ModulatedCurve(flat, { ...NO_MODIFIERS, noiseStddev: 5 }, 1, 15_000);
    const other = new ModulatedCurve(flat, { ...NO_MODIFIERS, noiseStddev: 5 }, 2, 15_000);

    assert.notEqual(one.valueAt(0), other.valueAt(0));
  });

  it('peaks seasonality at peakAt and troughs half a period later', () => {
    const curve = new ModulatedCurve(
      flat,
      { ...NO_MODIFIERS, seasonality: { periodMs: 24 * 60 * MINUTE, amplitude: 0.2, peakAtMs: 14 * 60 * MINUTE } },
      1,
      15_000,
    );

    assert.ok(Math.abs(curve.valueAt(14 * 60 * MINUTE) - 120) < 1e-9);
    assert.ok(Math.abs(curve.valueAt(2 * 60 * MINUTE) - 80) < 1e-9);
  });

  it('rounds counts after noise and clamping', () => {
    const curve = new ModulatedCurve(
      new PhasedCurve(11, []),
      { ...NO_MODIFIERS, noiseStddev: 1.2, min: 0, round: true },
      7,
      1_000,
    );

    for (let second = 0; second < 50; second += 1) {
      assert.ok(Number.isInteger(curve.valueAt(second * 1_000)));
    }
  });

  it('clamps after noise', () => {
    const curve = new ModulatedCurve(
      new PhasedCurve(0, []),
      { ...NO_MODIFIERS, noiseStddev: 10, min: 0, max: 1 },
      99,
      1_000,
    );

    for (let second = 0; second < 200; second += 1) {
      const value = curve.valueAt(second * 1_000);
      assert.ok(value >= 0 && value <= 1);
    }
  });
});
