import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ComponentType, type ManifestKind } from '../../enums';
import type { IComponentSpecV1, IComponentV1 } from '../../interfaces/v1';
import { DataModelEntrySchemaV1 } from './data-model.schema';
import { DependencySchemaV1 } from './dependency.schema';
import { ExposedInterfaceSchemaV1 } from './exposed-interface.schema';
import { IndicatorSchemaV1 } from './indicator.schema';
import { MetricDefinitionSchemaV1 } from './metric-definition.schema';
import { ResourceSchemaV1, SystemScopedMetadataSchemaV1 } from './resource.schema';
import { TelemetryIdentitySchemaV1 } from './telemetry.schema';
import { TopologySchemaV1 } from './topology.schema';

export class ComponentSpecSchemaV1 implements IComponentSpecV1 {
  @IsEnum(ComponentType)
  type!: ComponentType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  engine?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExposedInterfaceSchemaV1)
  exposes: ExposedInterfaceSchemaV1[] = [];

  @ValidateNested()
  @Type(() => TelemetryIdentitySchemaV1)
  telemetry: TelemetryIdentitySchemaV1 = new TelemetryIdentitySchemaV1();

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetricDefinitionSchemaV1)
  metrics: MetricDefinitionSchemaV1[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndicatorSchemaV1)
  indicators: IndicatorSchemaV1[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DependencySchemaV1)
  dependsOn: DependencySchemaV1[] = [];

  @ValidateNested()
  @Type(() => TopologySchemaV1)
  topology?: TopologySchemaV1;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DataModelEntrySchemaV1)
  dataModel: DataModelEntrySchemaV1[] = [];
}

export class ComponentSchemaV1
  extends ResourceSchemaV1<ManifestKind.Component>
  implements IComponentV1
{
  @IsDefined()
  @ValidateNested()
  @Type(() => SystemScopedMetadataSchemaV1)
  metadata!: SystemScopedMetadataSchemaV1;

  @IsDefined()
  @ValidateNested()
  @Type(() => ComponentSpecSchemaV1)
  spec!: ComponentSpecSchemaV1;
}
