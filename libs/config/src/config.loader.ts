import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { ConfigEnvVariable, type ConfigVersion } from './enums';
import { ConfigError, ConfigErrorCode } from './errors';
import { ConfigParser, type ConfigDocument } from './parsers/config.parser';
import { ConfigV1Parser } from './parsers/v1/config-v1.parser';
import type { IHeimdallConfig } from './interfaces/heimdall-config.interface';

const FILE_NOT_FOUND = 'ENOENT';

@Injectable()
export class ConfigLoader {
  private readonly parsers: ReadonlyMap<ConfigVersion, ConfigParser>;

  constructor(v1: ConfigV1Parser) {
    this.parsers = new Map([[v1.version, v1]]);
  }

  async load(filePath: string): Promise<IHeimdallConfig> {
    return this.parse(await this.read(filePath));
  }

  async parse(source: string): Promise<IHeimdallConfig> {
    const document = ConfigParser.read(source);
    return this.parserFor(document).parse(document);
  }

  // Checked before schema validation so an unsupported version is reported plainly,
  // not as a pile of downstream field errors.
  private parserFor(document: ConfigDocument): ConfigParser {
    const version = document['version'];

    if (version === undefined) {
      throw new ConfigError(ConfigErrorCode.ConfigInvalid, 'version: is required');
    }

    const parser = this.parsers.get(version as ConfigVersion);

    if (parser === undefined) {
      throw new ConfigError(
        ConfigErrorCode.ConfigUnsupportedVersion,
        `config version ${String(version)} is not supported; expected one of ${[...this.parsers.keys()].join(', ')}`,
      );
    }
    return parser;
  }

  private async read(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === FILE_NOT_FOUND) {
        throw new ConfigError(
          ConfigErrorCode.ConfigFileNotFound,
          `no config file at ${filePath}; check ${ConfigEnvVariable.ConfigPath} or unset it to use the default`,
          { cause: error },
        );
      }
      throw new ConfigError(
        ConfigErrorCode.ConfigFileUnreadable,
        `cannot read ${filePath}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}
