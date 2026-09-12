import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';
import { ConfigError, ConfigErrorCode } from '../domain/errors';
import { CONFIG_VERSION, heimdallConfigSchema, type HeimdallConfig } from './schema';

const MAX_REPORTED_ISSUES = 10;

/**
 * Turns raw YAML into a validated config, or throws a `ConfigError` carrying a
 * specific code. Pure — no filesystem — so the failure modes are cheap to test.
 */
export function parseConfig(source: string): HeimdallConfig {
  const document = readYaml(source);
  assertSupportedVersion(document);

  const result = heimdallConfigSchema.safeParse(document);

  if (!result.success) {
    throw new ConfigError(
      ConfigErrorCode.ConfigInvalid,
      describeIssues(result.error),
      { cause: result.error },
    );
  }
  return result.data;
}

function readYaml(source: string): unknown {
  try {
    return parseYaml(source);
  } catch (error) {
    const detail = error instanceof YAMLParseError ? error.message : String(error);
    throw new ConfigError(ConfigErrorCode.ConfigParseFailed, detail, { cause: error });
  }
}

/**
 * Checked ahead of full validation so a config written for a future Heimdall
 * reports that plainly, instead of an avalanche of schema errors that obscures the
 * actual problem.
 */
function assertSupportedVersion(document: unknown): void {
  if (typeof document !== 'object' || document === null) {
    throw new ConfigError(
      ConfigErrorCode.ConfigInvalid,
      'config must be a YAML mapping',
    );
  }

  const version = (document as { version?: unknown }).version;

  if (version !== undefined && version !== CONFIG_VERSION) {
    throw new ConfigError(
      ConfigErrorCode.ConfigUnsupportedVersion,
      `config version ${String(version)} is not supported; expected ${CONFIG_VERSION}`,
    );
  }
}

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const location = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${location}: ${issue.message}`;
  });
  const omitted = error.issues.length - issues.length;

  return omitted > 0
    ? `${issues.join('; ')} (and ${omitted} more)`
    : issues.join('; ');
}
