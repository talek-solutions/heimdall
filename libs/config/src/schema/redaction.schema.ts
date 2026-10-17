import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsString, Matches, ValidateNested } from 'class-validator';
import { Scrubber } from '../enums';
import { IsSafePattern } from './is-safe-pattern.decorator';

/** Becomes `[REDACTED:<name>]` and a counter attribute, so it stays short and plain. */
export const PATTERN_NAME = /^[a-z][a-zA-Z0-9-]{0,31}$/;

export class AdditionalPatternConfig {
  @IsString()
  @Matches(PATTERN_NAME, {
    message: '$property must start with a lowercase letter and use at most 32 letters, digits or -',
  })
  name!: string;

  @IsString()
  @IsSafePattern()
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
