import type { LogLevel, OutputFormat } from '@heimdall/core';

/** Raw flags as commander hands them over. Every field may be absent. */
export interface CliFlags {
  readonly json?: boolean;
  readonly ndjson?: boolean;
  readonly verbose?: boolean;
  readonly quiet?: boolean;
  /** commander sets this to false for `--no-color`. */
  readonly color?: boolean;
}

/** Fully resolved settings. No optionals — every question is answered here. */
export interface CliConfig {
  readonly outputFormat: OutputFormat;
  readonly logLevel: LogLevel;
  readonly color: boolean;
  readonly showBanner: boolean;
}
