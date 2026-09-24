import { LogLevel, OutputFormat } from '@heimdall/core';
import type { IDefaultsConfig } from '@heimdall/config';
import { CliError, CliErrorCode } from '../errors';
import type { CliConfig, CliFlags } from './cli-config.model';

export const ENV = {
  Output: 'HEIMDALL_OUTPUT',
  LogLevel: 'HEIMDALL_LOG_LEVEL',
  /** Honoured per the informal no-color.org convention: presence disables colour. */
  NoColor: 'NO_COLOR',
} as const;

export interface ResolveInput {
  readonly flags: CliFlags;
  readonly env: NodeJS.ProcessEnv;
  /** The `defaults` block of the config file. */
  readonly file?: IDefaultsConfig;
  /** Whether stdout is a terminal. */
  readonly isTty: boolean;
}

/**
 * Resolves settings across four layers: flag > env > file > built-in default.
 *
 * Pure by design. Precedence bugs are the kind that only surface in someone's
 * unusual shell, so this is a function over explicit inputs rather than something
 * that reads `process.env` on its own.
 */
export function resolveCliConfig(input: ResolveInput): CliConfig {
  const outputFormat = resolveOutputFormat(input);
  const logLevel = resolveLogLevel(input);
  const color = resolveColor(input, outputFormat);

  return {
    outputFormat,
    logLevel,
    color,
    // A banner is decoration: it belongs only in an interactive text session, and
    // never in a machine format or a silenced run (ADR 0006).
    showBanner: input.isTty && outputFormat === OutputFormat.Text && logLevel !== LogLevel.Silent,
  };
}

function resolveOutputFormat(input: ResolveInput): OutputFormat {
  const { json, ndjson } = input.flags;

  if (json === true && ndjson === true) {
    throw new CliError(
      CliErrorCode.ConflictingOutputFormats,
      'pass only one of --json or --ndjson',
    );
  }
  if (json === true) {
    return OutputFormat.Json;
  }
  if (ndjson === true) {
    return OutputFormat.Ndjson;
  }

  const fromEnv = input.env[ENV.Output];
  if (fromEnv !== undefined && fromEnv !== '') {
    return parseEnum(OutputFormat, fromEnv, ENV.Output);
  }
  return input.file?.output ?? OutputFormat.Text;
}

function resolveLogLevel(input: ResolveInput): LogLevel {
  const { verbose, quiet } = input.flags;

  if (verbose === true && quiet === true) {
    throw new CliError(CliErrorCode.ConflictingVerbosity, 'pass only one of --verbose or --quiet');
  }
  if (verbose === true) {
    return LogLevel.Debug;
  }
  // --quiet silences progress but never suppresses errors: a failed investigation
  // must still say why.
  if (quiet === true) {
    return LogLevel.Error;
  }

  const fromEnv = input.env[ENV.LogLevel];
  if (fromEnv !== undefined && fromEnv !== '') {
    return parseEnum(LogLevel, fromEnv, ENV.LogLevel);
  }
  return input.file?.logLevel ?? LogLevel.Info;
}

function resolveColor(input: ResolveInput, outputFormat: OutputFormat): boolean {
  if (input.flags.color === false) {
    return false;
  }
  // NO_COLOR is honoured by presence, whatever the value — except for the empty
  // string, which the convention treats as unset.
  if ((input.env[ENV.NoColor] ?? '') !== '') {
    return false;
  }
  if (outputFormat !== OutputFormat.Text) {
    return false;
  }
  return input.isTty;
}

function parseEnum<T extends Record<string, string>>(
  members: T,
  value: string,
  variableName: string,
): T[keyof T] {
  const allowed = Object.values(members);

  if (!allowed.includes(value)) {
    throw new CliError(
      CliErrorCode.InvalidEnvironmentValue,
      `${variableName}='${value}' is not valid; expected one of ${allowed.join(', ')}`,
    );
  }
  return value as T[keyof T];
}
