import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import {
  IndicatorRole,
  LabelSemantic,
  ManifestProvenance,
  MetricType,
  Transport,
} from '../../enums';
import type { IMeasuresV1, IMetricDefinitionV1 } from '../../interfaces/v1';
import { IsRecord } from './decorators/is-record.decorator';
import { ExactlyOneOf } from './decorators/one-of.decorator';
import {
  LABEL_NAME,
  METRIC_NAME,
  METRIC_NAME_MESSAGE,
  RESOURCE_NAME,
  RESOURCE_NAME_MESSAGE,
} from './identifiers';

@ExactlyOneOf(['inbound', 'outbound'])
export class MeasuresSchemaV1 implements IMeasuresV1 {
  @IsOptional()
  @IsEnum(Transport)
  inbound?: Transport;

  /** A dependency name on the same component. */
  @IsOptional()
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  outbound?: string;
}

export class MetricDefinitionSchemaV1 implements IMetricDefinitionV1 {
  @Matches(METRIC_NAME, { message: METRIC_NAME_MESSAGE })
  name!: string;

  @IsEnum(MetricType)
  type!: MetricType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @IsOptional()
  @IsEnum(IndicatorRole)
  role?: IndicatorRole;

  @ValidateNested()
  @Type(() => MeasuresSchemaV1)
  measures?: MeasuresSchemaV1;

  // A closed set: indicator derivation branches on these meanings (ADR 0015).
  @IsRecord({ key: LABEL_NAME, value: Object.values(LabelSemantic) })
  labels: Record<string, LabelSemantic> = {};

  @IsEnum(ManifestProvenance)
  provenance: ManifestProvenance = ManifestProvenance.Declared;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;
}
