import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TempoSpanKind } from '../../../connectors/tempo/tempo.enums';
import { CurveSchema } from './curve.schema';
import { SERIES_ID_MESSAGE, SERIES_ID_PATTERN } from './identifiers';
import { IsAttributeRecord } from './is-attribute-record.decorator';

export type SpanAttributeValue = string | number | boolean;

export class SpanSchema {
  @IsString()
  @IsNotEmpty()
  service!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(TempoSpanKind)
  kind: TempoSpanKind = TempoSpanKind.Internal;

  @IsAttributeRecord()
  attributes: Record<string, SpanAttributeValue> = {};

  /** Merged over `attributes` when this span is on the error path. */
  @IsAttributeRecord()
  errorAttributes: Record<string, SpanAttributeValue> = {};

  /** Fraction of the parent's duration, laid out after the previous sibling. Ignored on the root. */
  @ValidateNested()
  @Type(() => CurveSchema)
  share: CurveSchema = Object.assign(new CurveSchema(), { baseline: 0.1 });

  /** Where an error trace fails; its ancestors inherit the error status. Defaults to the root. */
  @IsBoolean()
  errorSource = false;

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpanSchema)
  children: SpanSchema[] = [];
}

export class TraceTemplateSchema {
  /** Referenced from log lines as `{traceId:<id>}`. */
  @Matches(SERIES_ID_PATTERN, { message: SERIES_ID_MESSAGE })
  id!: string;

  /** Regex tested against the TraceQL query; without one, every search considers this template. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  match?: string;

  /** Sampled traces per second. */
  @IsDefined()
  @ValidateNested()
  @Type(() => CurveSchema)
  rate!: CurveSchema;

  /** Median root duration in milliseconds. */
  @IsDefined()
  @ValidateNested()
  @Type(() => CurveSchema)
  duration!: CurveSchema;

  /** Root duration of error traces, e.g. a timeout; defaults to `duration`. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CurveSchema)
  errorDuration?: CurveSchema;

  /** Log-normal spread of the root duration around its median. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(2)
  jitter = 0.25;

  /** Probability, 0 to 1, that a trace is an error. */
  @ValidateNested()
  @Type(() => CurveSchema)
  error: CurveSchema = Object.assign(new CurveSchema(), { baseline: 0 });

  @IsDefined()
  @ValidateNested()
  @Type(() => SpanSchema)
  root!: SpanSchema;
}

export class TracesFileSchema {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TraceTemplateSchema)
  traces: TraceTemplateSchema[] = [];
}
