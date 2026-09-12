import { LogLevel, OutputFormat } from '@heimdall/core';
import { z } from 'zod';

/**
 * Project-level preferences. Every field is optional: this is one layer in the
 * precedence chain (flag > env > file > built-in default), not a complete setting.
 */
export const defaultsSchema = z.object({
  output: z.enum(OutputFormat).optional(),
  logLevel: z.enum(LogLevel).optional(),
});

export type DefaultsConfig = z.infer<typeof defaultsSchema>;
