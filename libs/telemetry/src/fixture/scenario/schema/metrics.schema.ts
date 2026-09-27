import 'reflect-metadata';
import { Type } from 'class-transformer';
import { IsArray, IsDefined, IsNotEmpty, IsString, Matches, ValidateNested } from 'class-validator';
import { CurveSchema } from './curve.schema';
import { LABEL_NAME_PATTERN, SERIES_ID_MESSAGE, SERIES_ID_PATTERN } from './identifiers';
import { IsStringRecord } from './is-string-record.decorator';

/** One query-result series: the fixture cannot evaluate PromQL, so this IS the answer. */
export class MetricSeriesSchema {
  @Matches(SERIES_ID_PATTERN, { message: SERIES_ID_MESSAGE })
  id!: string;

  /** Regex tested against the incoming query; the first matching pattern wins. */
  @IsString()
  @IsNotEmpty()
  match!: string;

  @IsStringRecord(LABEL_NAME_PATTERN)
  labels: Record<string, string> = {};

  @IsDefined()
  @ValidateNested()
  @Type(() => CurveSchema)
  curve!: CurveSchema;
}

export class MetricsFileSchema {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetricSeriesSchema)
  series: MetricSeriesSchema[] = [];
}
