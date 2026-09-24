import { Type } from 'class-transformer';
import { Equals, IsArray, IsEnum, IsOptional, Matches, ValidateNested } from 'class-validator';
import { ConfigKind, ConfigVersion } from '../enums';
import type { IHeimdallConfig } from '../interfaces/heimdall-config.interface';
import { ContextConfig } from './context.schema';
import { DefaultsConfig } from './defaults.schema';
import { RESOURCE_NAME, RESOURCE_NAME_MESSAGE } from './metadata.schema';
import { RedactionConfig } from './redaction.schema';
import { SOURCE_SUBTYPES, SourceConfigBase, type SourceConfig } from './source.schema';

export class HeimdallConfig implements IHeimdallConfig {
  @Equals(ConfigVersion.V1)
  version!: ConfigVersion.V1;

  @IsEnum(ConfigKind)
  kind!: ConfigKind;

  @IsOptional()
  @Matches(RESOURCE_NAME, { message: RESOURCE_NAME_MESSAGE })
  currentContext: string | null = null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceConfigBase, {
    discriminator: { property: 'type', subTypes: SOURCE_SUBTYPES },
    keepDiscriminatorProperty: true,
  })
  sources: SourceConfig[] = [];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContextConfig)
  contexts: ContextConfig[] = [];

  @ValidateNested()
  @Type(() => RedactionConfig)
  redaction: RedactionConfig = new RedactionConfig();

  @ValidateNested()
  @Type(() => DefaultsConfig)
  defaults: DefaultsConfig = new DefaultsConfig();
}
