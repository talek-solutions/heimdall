import { Injectable } from '@nestjs/common';
import { ConfigLoader, type DefaultsConfig, type HeimdallConfig } from '@heimdall/telemetry';
import { stdoutIsTty } from '../presentation/streams';
import type { CliConfig, CliFlags } from './cli-config.model';
import { resolveCliConfig, resolveConfigPath } from './cli-config.resolver';

@Injectable()
export class CliConfigService {
  constructor(private readonly loader: ConfigLoader) {}

  /**
   * Resolves CLI settings across flag > env > file > default.
   *
   * The file layer is best-effort on purpose: `heimdall --help` and `heimdall
   * version` must work in a directory with no config, or with a broken one. A
   * command that genuinely needs the config calls `load()`, which reports.
   */
  resolve(flags: CliFlags): CliConfig {
    const configPath = resolveConfigPath({ flags, env: process.env });

    return resolveCliConfig({
      flags,
      env: process.env,
      ...this.optionalDefaults(configPath),
      isTty: stdoutIsTty(),
    });
  }

  /** Loads and validates the config file, throwing `ConfigError` on any problem. */
  load(configPath: string): HeimdallConfig {
    return this.loader.load(configPath);
  }

  private optionalDefaults(configPath: string): { file?: DefaultsConfig } {
    try {
      return { file: this.loader.load(configPath).defaults };
    } catch {
      // Deliberately swallowed — see resolve(). The error surfaces from load()
      // when a command actually depends on the config.
      return {};
    }
  }
}
