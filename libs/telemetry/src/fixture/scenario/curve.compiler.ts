import {
  ModulatedCurve,
  PhasedCurve,
  PhaseShape,
  ReferenceCurve,
  type ICurve,
  type ISeasonality,
  type Phase,
} from '../engine/curve';
import { hashInts, hashString } from '../engine/deterministic-random';
import { parseDuration } from '../engine/duration';
import type { CurveSchema, PhaseSchema, SeasonalitySchema } from './schema/curve.schema';

export interface ICurveContext {
  readonly seed: number;
  readonly durationMs: number;
  readonly resolutionMs: number;
  /** Issues are collected, not thrown, so one load reports every problem. */
  readonly issues: string[];
  /** The target curve, or `undefined` after recording an issue. */
  resolveRef(id: string, path: string): ICurve | undefined;
}

/** Stands in for a curve that failed to compile, so compilation can continue collecting issues. */
const FLAT_ZERO: ICurve = new PhasedCurve(0, []);

/**
 * `key` namespaces the curve's noise: two curves with identical specs but
 * different keys get independent noise.
 */
export function compileCurve(
  spec: CurveSchema,
  key: string,
  path: string,
  context: ICurveContext,
): ICurve {
  const inner = compileSource(spec, path, context);
  const seasonality =
    spec.seasonality === undefined
      ? undefined
      : compileSeasonality(spec.seasonality, `${path}.seasonality`, context);

  if (spec.clamp?.min !== undefined && spec.clamp.max !== undefined && spec.clamp.min > spec.clamp.max) {
    context.issues.push(`${path}.clamp: min must not exceed max`);
  }
  if (
    seasonality === undefined &&
    spec.noise === undefined &&
    spec.clamp === undefined &&
    !spec.round
  ) {
    return inner;
  }
  return new ModulatedCurve(
    inner,
    {
      seasonality,
      noiseStddev: spec.noise?.stddev,
      min: spec.clamp?.min,
      max: spec.clamp?.max,
      round: spec.round,
    },
    hashInts([context.seed, hashString(key)]),
    context.resolutionMs,
  );
}

function compileSource(spec: CurveSchema, path: string, context: ICurveContext): ICurve {
  if ((spec.baseline === undefined) === (spec.ref === undefined)) {
    context.issues.push(`${path}: exactly one of baseline or ref is required`);
    return FLAT_ZERO;
  }
  if (spec.ref !== undefined) {
    if (spec.phases.length > 0) {
      context.issues.push(`${path}.phases: phases shape a baseline; a ref curve follows its target`);
    }
    const target = context.resolveRef(spec.ref, `${path}.ref`);
    return target === undefined ? FLAT_ZERO : new ReferenceCurve(target, spec.scale, spec.offset);
  }
  if (spec.scale !== 1 || spec.offset !== 0) {
    context.issues.push(`${path}: scale and offset apply to a ref curve only`);
  }
  return new PhasedCurve(spec.baseline ?? 0, compilePhases(spec.phases, `${path}.phases`, context));
}

function compilePhases(specs: readonly PhaseSchema[], path: string, context: ICurveContext): Phase[] {
  const phases: Phase[] = [];
  let previousAtMs = 0;

  for (const [index, spec] of specs.entries()) {
    const phasePath = `${path}.${index}`;
    const atMs = parseDuration(spec.at) ?? 0;

    if (atMs > context.durationMs) {
      context.issues.push(`${phasePath}.at: ${spec.at} is beyond the scenario duration`);
    }
    if (atMs < previousAtMs) {
      context.issues.push(`${phasePath}.at: phases must be in time order`);
    }
    previousAtMs = atMs;
    phases.push(compilePhase(spec, atMs, phasePath, context));
  }
  return phases;
}

function compilePhase(spec: PhaseSchema, atMs: number, path: string, context: ICurveContext): Phase {
  switch (spec.shape) {
    case PhaseShape.Ramp:
      return { shape: spec.shape, atMs, to: spec.to, overMs: parseDuration(spec.over) ?? 0 };
    case PhaseShape.Spike:
      return {
        shape: spec.shape,
        atMs,
        to: spec.to,
        decayMs: positive(spec.decay, `${path}.decay`, context),
      };
    case PhaseShape.Sawtooth:
      return {
        shape: spec.shape,
        atMs,
        to: spec.to,
        periodMs: positive(spec.period, `${path}.period`, context),
      };
    case PhaseShape.Hold:
      return { shape: spec.shape, atMs };
  }
}

function compileSeasonality(
  spec: SeasonalitySchema,
  path: string,
  context: ICurveContext,
): ISeasonality {
  return {
    periodMs: positive(spec.period, `${path}.period`, context),
    amplitude: spec.amplitude,
    peakAtMs: parseDuration(spec.peakAt) ?? 0,
  };
}

/** Durations are schema-validated; this only rules out zero where it would divide. */
function positive(duration: string, path: string, context: ICurveContext): number {
  const millis = parseDuration(duration) ?? 0;

  if (millis <= 0) {
    context.issues.push(`${path}: must be longer than zero`);
    return 1;
  }
  return millis;
}
