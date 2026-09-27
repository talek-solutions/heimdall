import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import type { ManifestKind } from '../../enums';
import type { IEnvironmentV1, ISystemSpecV1, ISystemV1 } from '../../interfaces/v1';
import { IsRecord } from './decorators/is-record.decorator';
import { LABEL_NAME, RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './identifiers';
import { ResourceMetadataSchemaV1, ResourceSchemaV1 } from './resource.schema';

export class EnvironmentSchemaV1 implements IEnvironmentV1 {
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  name!: string;

  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  context!: string;

  @IsRecord({ key: LABEL_NAME })
  labels: Record<string, string> = {};
}

export class SystemSpecSchemaV1 implements ISystemSpecV1 {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvironmentSchemaV1)
  environments: EnvironmentSchemaV1[] = [];
}

export class SystemSchemaV1 extends ResourceSchemaV1<ManifestKind.System> implements ISystemV1 {
  @IsDefined()
  @ValidateNested()
  @Type(() => ResourceMetadataSchemaV1)
  metadata!: ResourceMetadataSchemaV1;

  @IsDefined()
  @ValidateNested()
  @Type(() => SystemSpecSchemaV1)
  spec!: SystemSpecSchemaV1;
}
