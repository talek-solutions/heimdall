import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { ConfigError, ConfigErrorCode } from '../domain/errors';
import { parseConfig } from './config.parser';
import type { HeimdallConfig } from './schema';

const FILE_NOT_FOUND = 'ENOENT';

@Injectable()
export class ConfigLoader {
  load(filePath: string): HeimdallConfig {
    return parseConfig(this.read(filePath));
  }

  private read(filePath: string): string {
    try {
      return readFileSync(filePath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === FILE_NOT_FOUND) {
        throw new ConfigError(
          ConfigErrorCode.ConfigFileNotFound,
          `no config file at ${filePath}; run 'heimdall init' to create one`,
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
