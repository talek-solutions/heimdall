import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { InteractionMode, LabelSemantic, type ManifestKind } from '../../enums';
import type { IFlowSpecV1, IFlowStepV1, IFlowV1 } from '../../interfaces/v1';
import { IsRecord } from './decorators/is-record.decorator';
import {
  DEPENDENCY_REFERENCE,
  DEPENDENCY_REFERENCE_MESSAGE,
  SEMANTIC_NAME,
  SEMANTIC_NAME_MESSAGE,
} from './identifiers';
import { IndicatorSchemaV1 } from './indicator.schema';
import { ResourceSchemaV1, SystemScopedMetadataSchemaV1 } from './resource.schema';

export class FlowStepSchemaV1 implements IFlowStepV1 {
  @Matches(DEPENDENCY_REFERENCE, { message: DEPENDENCY_REFERENCE_MESSAGE })
  dependency!: string;

  @IsRecord({ key: Object.values(LabelSemantic) })
  match: Partial<Record<LabelSemantic, string>> = {};

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndicatorSchemaV1)
  indicators: IndicatorSchemaV1[] = [];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;
}

export class FlowSpecSchemaV1 implements IFlowSpecV1 {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsEnum(InteractionMode)
  mode!: InteractionMode;

  @IsBoolean()
  propagatesTraceContext = true;

  @IsOptional()
  @Matches(SEMANTIC_NAME, { message: SEMANTIC_NAME_MESSAGE })
  correlationKey?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FlowStepSchemaV1)
  steps!: FlowStepSchemaV1[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndicatorSchemaV1)
  indicators: IndicatorSchemaV1[] = [];
}

export class FlowSchemaV1 extends ResourceSchemaV1<ManifestKind.Flow> implements IFlowV1 {
  @IsDefined()
  @ValidateNested()
  @Type(() => SystemScopedMetadataSchemaV1)
  metadata!: SystemScopedMetadataSchemaV1;

  @IsDefined()
  @ValidateNested()
  @Type(() => FlowSpecSchemaV1)
  spec!: FlowSpecSchemaV1;
}
