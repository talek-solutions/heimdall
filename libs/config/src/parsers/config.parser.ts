import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { ConfigVersion } from '../enums';
import { ConfigError, ConfigErrorCode } from '../errors';
import type { IHeimdallConfig } from '../interfaces/heimdall-config.interface';

const MAX_REPORTED_ISSUES = 10;

export type ConfigDocument = Readonly<Record<string, unknown>>;

export abstract class ConfigParser {
  abstract readonly version: ConfigVersion;
  protected abstract readonly schema: ClassConstructor<IHeimdallConfig>;

  static read(source: string): ConfigDocument {
    let document: unknown;
    try {
      document = parseYaml(source);
    } catch (error) {
      const detail = error instanceof YAMLParseError ? error.message : String(error);
      throw new ConfigError(ConfigErrorCode.ConfigParseFailed, detail, { cause: error });
    }

    if (typeof document !== 'object' || document === null || Array.isArray(document)) {
      throw new ConfigError(ConfigErrorCode.ConfigInvalid, 'config must be a YAML mapping');
    }
    return document as ConfigDocument;
  }

  async parse(document: ConfigDocument): Promise<IHeimdallConfig> {
    const config = plainToInstance(this.schema, document, { exposeDefaultValues: true });
    const errors = await validate(config, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    // Cross-field rules only make sense once every field has the right shape.
    const issues = errors.length > 0 ? this.flatten(errors) : this.validateReferences(config);

    if (issues.length > 0) {
      throw new ConfigError(ConfigErrorCode.ConfigInvalid, this.describe(issues));
    }
    return config;
  }

  protected validateReferences(_config: IHeimdallConfig): string[] {
    return [];
  }

  private flatten(errors: readonly ValidationError[], parent = ''): string[] {
    return errors.flatMap((error) => {
      const location = parent === '' ? error.property : `${parent}.${error.property}`;
      const own = Object.values(error.constraints ?? {}).map(
        (message) => `${location}: ${message}`,
      );
      return [...own, ...this.flatten(error.children ?? [], location)];
    });
  }

  private describe(issues: readonly string[]): string {
    const reported = issues.slice(0, MAX_REPORTED_ISSUES);
    const omitted = issues.length - reported.length;

    return omitted > 0 ? `${reported.join('; ')} (and ${omitted} more)` : reported.join('; ');
  }
}
