import 'reflect-metadata';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CurveSchema } from './curve.schema';
import { LABEL_NAME_PATTERN, SERIES_ID_MESSAGE, SERIES_ID_PATTERN } from './identifiers';
import { IsStringRecord } from './is-string-record.decorator';
import { MetricSeriesSchema } from './metrics.schema';

export class LogTemplateSchema {
  /** Text with placeholders: {uuid} {hex:16} {int:1-9} {pick:a|b} {ref:series*1000} {traceId:template}. */
  @IsString()
  @IsNotEmpty()
  line!: string;

  /** Relative weight among the stream's templates; a curve, so a template can fade in with the incident. */
  @ValidateNested()
  @Type(() => CurveSchema)
  weight: CurveSchema = Object.assign(new CurveSchema(), { baseline: 1 });
}

export class LogStreamSchema {
  @Matches(SERIES_ID_PATTERN, { message: SERIES_ID_MESSAGE })
  id!: string;

  /** Optional: streams without one answer every log query, narrowed by their labels. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  match?: string;

  @IsStringRecord(LABEL_NAME_PATTERN)
  labels!: Record<string, string>;

  /** Lines per second. */
  @IsDefined()
  @ValidateNested()
  @Type(() => CurveSchema)
  rate!: CurveSchema;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LogTemplateSchema)
  templates!: LogTemplateSchema[];
}

/** A metric LogQL result. */
export class LokiSeriesSchema extends MetricSeriesSchema {
  /**
   * The curve is per second and the query's range selector scales it, so
   * `count_over_time(…[5m])` answers five times `count_over_time(…[1m])`.
   */
  @IsBoolean()
  scaleByRange = false;
}

export class LogsFileSchema {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LogStreamSchema)
  streams: LogStreamSchema[] = [];

  /** Results of metric LogQL (`count_over_time`, `rate`, …), routed like metric series. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LokiSeriesSchema)
  series: LokiSeriesSchema[] = [];
}
