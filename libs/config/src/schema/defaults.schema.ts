import { IsEnum, IsOptional } from 'class-validator';
import { LogLevel, OutputFormat } from '@heimdall/core';

/**
 * Project-level preferences. Every field is optional: this is one layer in the
 * precedence chain (flag > env > file > built-in default), not a complete setting.
 */
export class DefaultsConfig {
  @IsOptional()
  @IsEnum(OutputFormat)
  output?: OutputFormat;

  @IsOptional()
  @IsEnum(LogLevel)
  logLevel?: LogLevel;
}
