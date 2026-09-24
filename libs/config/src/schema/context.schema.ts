import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { MetadataConfig, RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './metadata.schema';

export class ContextConfig {
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  sources!: string[];

  @ValidateNested()
  @Type(() => MetadataConfig)
  metadata: MetadataConfig = new MetadataConfig();
}
