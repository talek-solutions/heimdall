import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Scrubber } from '../enums';

export class AdditionalPatternConfig {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  pattern!: string;
}

export class RedactionConfig {
  /** Defaults to every scrubber: opting OUT must be deliberate, never accidental. */
  @IsArray()
  @IsEnum(Scrubber, { each: true })
  scrubbers: Scrubber[] = Object.values(Scrubber);

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdditionalPatternConfig)
  additionalPatterns: AdditionalPatternConfig[] = [];
}
