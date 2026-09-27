import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PhaseShape } from '../../engine/curve';
import { DURATION_PATTERN } from '../../engine/duration';
import { DURATION_MESSAGE, SERIES_ID_MESSAGE, SERIES_ID_PATTERN } from './identifiers';

const FINITE = { allowNaN: false, allowInfinity: false };

export class PhaseSchemaBase<S extends PhaseShape = PhaseShape> {
  @IsEnum(PhaseShape)
  shape!: S;

  /** Offset from the start of the timeline. */
  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  at!: string;
}

export class RampPhaseSchema extends PhaseSchemaBase<PhaseShape.Ramp> {
  @IsNumber(FINITE)
  to!: number;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  over = '0s';
}

export class SpikePhaseSchema extends PhaseSchemaBase<PhaseShape.Spike> {
  @IsNumber(FINITE)
  to!: number;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  decay!: string;
}

export class SawtoothPhaseSchema extends PhaseSchemaBase<PhaseShape.Sawtooth> {
  @IsNumber(FINITE)
  to!: number;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  period!: string;
}

export class HoldPhaseSchema extends PhaseSchemaBase<PhaseShape.Hold> {}

export type PhaseSchema = RampPhaseSchema | SpikePhaseSchema | SawtoothPhaseSchema | HoldPhaseSchema;

const PHASE_SUBTYPES = [
  { value: RampPhaseSchema, name: PhaseShape.Ramp },
  { value: SpikePhaseSchema, name: PhaseShape.Spike },
  { value: SawtoothPhaseSchema, name: PhaseShape.Sawtooth },
  { value: HoldPhaseSchema, name: PhaseShape.Hold },
];

export class SeasonalitySchema {
  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  period!: string;

  @IsNumber(FINITE)
  @Min(0)
  @Max(1)
  amplitude!: number;

  @Matches(DURATION_PATTERN, { message: DURATION_MESSAGE })
  peakAt = '0s';
}

export class NoiseSchema {
  @IsNumber(FINITE)
  @Min(0)
  stddev!: number;
}

export class ClampSchema {
  @IsOptional()
  @IsNumber(FINITE)
  min?: number;

  @IsOptional()
  @IsNumber(FINITE)
  max?: number;
}

/** Exactly one of `baseline` (with optional phases) or `ref` (with optional scale). */
export class CurveSchema {
  @IsOptional()
  @IsNumber(FINITE)
  baseline?: number;

  @IsOptional()
  @Matches(SERIES_ID_PATTERN, { message: SERIES_ID_MESSAGE })
  ref?: string;

  @IsNumber(FINITE)
  scale = 1;

  /** Added after `scale`; with a clamp, `offset: -3.5` keeps only what is above 3.5. */
  @IsNumber(FINITE)
  offset = 0;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PhaseSchemaBase, {
    discriminator: { property: 'shape', subTypes: PHASE_SUBTYPES },
    keepDiscriminatorProperty: true,
  })
  phases: PhaseSchema[] = [];

  @IsOptional()
  @ValidateNested()
  @Type(() => SeasonalitySchema)
  seasonality?: SeasonalitySchema;

  @IsOptional()
  @ValidateNested()
  @Type(() => NoiseSchema)
  noise?: NoiseSchema;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClampSchema)
  clamp?: ClampSchema;

  @IsBoolean()
  round = false;
}
