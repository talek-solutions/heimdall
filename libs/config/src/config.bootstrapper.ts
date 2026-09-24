import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigError, ConfigErrorCode } from './errors';
import { DEFAULT_CONFIG_YAML } from './default-config';

const FILE_EXISTS = 'EEXIST';
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

@Injectable()
export class ConfigBootstrapper {
  /** Exclusive create (`wx`): never overwrites, without a check-then-write race. */
  async ensureDefault(filePath: string): Promise<boolean> {
    try {
      await mkdir(path.dirname(filePath), { recursive: true, mode: DIRECTORY_MODE });
    } catch (error) {
      throw this.writeFailed(filePath, error);
    }

    try {
      await writeFile(filePath, DEFAULT_CONFIG_YAML, { flag: 'wx', mode: FILE_MODE });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === FILE_EXISTS) {
        return false;
      }
      throw this.writeFailed(filePath, error);
    }
  }

  private writeFailed(filePath: string, error: unknown): ConfigError {
    return new ConfigError(
      ConfigErrorCode.ConfigWriteFailed,
      `cannot create default config at ${filePath}: ${(error as Error).message}`,
      { cause: error },
    );
  }
}
