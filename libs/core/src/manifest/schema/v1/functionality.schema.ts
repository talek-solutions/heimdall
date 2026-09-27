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
import type { IFunctionalitySpecV1, IFunctionalityV1 } from '../../interfaces/v1';
import { RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './identifiers';
import { IndicatorSchemaV1 } from './indicator.schema';
import { ResourceSchemaV1, SystemScopedMetadataSchemaV1 } from './resource.schema';

export class FunctionalitySpecSchemaV1 implements IFunctionalitySpecV1 {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsArray()
  @Matches(RESOURCE_NAME, { each: true, message: RESOURCE_NAME_MESSAGE })
  flows: string[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IndicatorSchemaV1)
  indicators: IndicatorSchemaV1[] = [];
}

export class FunctionalitySchemaV1
  extends ResourceSchemaV1<ManifestKind.Functionality>
  implements IFunctionalityV1
{
  @IsDefined()
  @ValidateNested()
  @Type(() => SystemScopedMetadataSchemaV1)
  metadata!: SystemScopedMetadataSchemaV1;

  @IsDefined()
  @ValidateNested()
  @Type(() => FunctionalitySpecSchemaV1)
  spec!: FunctionalitySpecSchemaV1;
}
