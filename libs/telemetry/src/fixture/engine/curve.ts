import { DeterministicRandom } from './deterministic-random';

export enum PhaseShape {
  /** Linear move to `to` over `over`; `over: 0s` is a step, ramping to the baseline a recovery. */
  Ramp = 'ramp',
  /** Jump to `to`, then decay exponentially back to the level before the spike. */
  Spike = 'spike',
  /** Linear climb to `to` over `period`, drop back, repeat, e.g. a leaking heap and its OOM kills. */
  Sawtooth = 'sawtooth',
  /** Freeze the current level, e.g. to end a sawtooth. */
  Hold = 'hold',
}

export type Phase =
  | { readonly shape: PhaseShape.Ramp; readonly atMs: number; readonly to: number; readonly overMs: number }
  | { readonly shape: PhaseShape.Spike; readonly atMs: number; readonly to: number; readonly decayMs: number }
  | {
      readonly shape: PhaseShape.Sawtooth;
      readonly atMs: number;
      readonly to: number;
      readonly periodMs: number;
    }
  | { readonly shape: PhaseShape.Hold; readonly atMs: number };

export interface ISeasonality {
  readonly periodMs: number;
  /** Relative: 0.2 swings the value ±20%. */
  readonly amplitude: number;
  readonly peakAtMs: number;
}

export interface ICurveModifiers {
  readonly seasonality: ISeasonality | undefined;
  /** Absolute standard deviation, in the curve's own unit. */
  readonly noiseStddev: number | undefined;
  readonly min: number | undefined;
  readonly max: number | undefined;
  /** Whole numbers, for counts: connections, locks, pods. */
  readonly round: boolean;
}

/** A value as a function of scenario-relative time. Pure: same input, same output. */
export interface ICurve {
  valueAt(relativeMs: number): number;
}

/** A spike has decayed ~95% after `decay`, i.e. three time constants. */
const SPIKE_DECAY_TIME_CONSTANTS = 3;

/** Baseline plus phases, sorted by `atMs`. Each phase starts from the level the previous one reached. */
export class PhasedCurve implements ICurve {
  private readonly startLevels: number[] = [];

  constructor(
    private readonly baseline: number,
    private readonly phases: readonly Phase[],
  ) {
    for (const [index, phase] of phases.entries()) {
      this.startLevels.push(index === 0 ? baseline : this.phaseValue(index - 1, phase.atMs));
    }
  }

  public valueAt(relativeMs: number): number {
    for (let index = this.phases.length - 1; index >= 0; index -= 1) {
      if ((this.phases[index]?.atMs ?? Infinity) <= relativeMs) {
        return this.phaseValue(index, relativeMs);
      }
    }
    return this.baseline;
  }

  private phaseValue(index: number, relativeMs: number): number {
    const phase = this.phases[index];
    const start = this.startLevels[index] ?? this.baseline;

    if (phase === undefined) {
      return start;
    }
    const elapsed = relativeMs - phase.atMs;

    switch (phase.shape) {
      case PhaseShape.Ramp:
        return phase.overMs === 0
          ? phase.to
          : start + (phase.to - start) * Math.min(1, elapsed / phase.overMs);
      case PhaseShape.Spike:
        return (
          start +
          (phase.to - start) * Math.exp((-elapsed * SPIKE_DECAY_TIME_CONSTANTS) / phase.decayMs)
        );
      case PhaseShape.Sawtooth:
        return start + (phase.to - start) * ((elapsed % phase.periodMs) / phase.periodMs);
      case PhaseShape.Hold:
        return start;
    }
  }
}

/** Another curve, scaled and shifted: how logs and traces follow the metrics they belong with. */
export class ReferenceCurve implements ICurve {
  constructor(
    private readonly target: ICurve,
    private readonly scale: number,
    private readonly offset = 0,
  ) {}

  public valueAt(relativeMs: number): number {
    return this.target.valueAt(relativeMs) * this.scale + this.offset;
  }
}

/**
 * Seasonality, noise, clamping and rounding around another curve. Noise is keyed on the
 * `resolutionMs` bucket, not on a sample index, so an instant has one value no
 * matter which query start or step reaches it.
 */
export class ModulatedCurve implements ICurve {
  constructor(
    private readonly inner: ICurve,
    private readonly modifiers: ICurveModifiers,
    private readonly noiseSeed: number,
    private readonly resolutionMs: number,
  ) {}

  public valueAt(relativeMs: number): number {
    const { seasonality, noiseStddev, min, max, round } = this.modifiers;
    let value = this.inner.valueAt(relativeMs);

    if (seasonality !== undefined) {
      const cycle = (relativeMs - seasonality.peakAtMs) / seasonality.periodMs;
      value *= 1 + seasonality.amplitude * Math.cos(2 * Math.PI * cycle);
    }
    if (noiseStddev !== undefined) {
      const bucket = Math.floor(relativeMs / this.resolutionMs);
      value += noiseStddev * DeterministicRandom.of([this.noiseSeed, bucket]).gaussian();
    }
    if (min !== undefined) {
      value = Math.max(min, value);
    }
    if (max !== undefined) {
      value = Math.min(max, value);
    }
    return round ? Math.round(value) : value;
  }
}
