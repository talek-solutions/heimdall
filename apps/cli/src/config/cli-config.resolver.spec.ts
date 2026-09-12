import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LogLevel, OutputFormat } from '@heimdall/core';
import { CliError, CliErrorCode } from '../errors';
import {
  DEFAULT_CONFIG_FILENAME,
  ENV,
  resolveCliConfig,
  type ResolveInput,
} from './cli-config.resolver';

function resolve(overrides: Partial<ResolveInput> = {}) {
  return resolveCliConfig({
    flags: {},
    env: {},
    isTty: true,
    ...overrides,
  });
}

describe('resolveCliConfig precedence', () => {
  describe('config path', () => {
    it('falls back to the built-in default', () => {
      assert.equal(resolve().configPath, DEFAULT_CONFIG_FILENAME);
    });

    it('prefers env over the default', () => {
      const config = resolve({ env: { [ENV.ConfigPath]: '/etc/heimdall.yaml' } });
      assert.equal(config.configPath, '/etc/heimdall.yaml');
    });

    it('prefers the flag over env', () => {
      const config = resolve({
        flags: { config: './local.yaml' },
        env: { [ENV.ConfigPath]: '/etc/heimdall.yaml' },
      });
      assert.equal(config.configPath, './local.yaml');
    });
  });

  describe('output format', () => {
    it('defaults to text', () => {
      assert.equal(resolve().outputFormat, OutputFormat.Text);
    });

    it('prefers the file layer over the default', () => {
      const config = resolve({ file: { output: OutputFormat.Ndjson } });
      assert.equal(config.outputFormat, OutputFormat.Ndjson);
    });

    it('prefers env over the file layer', () => {
      const config = resolve({
        env: { [ENV.Output]: OutputFormat.Json },
        file: { output: OutputFormat.Ndjson },
      });
      assert.equal(config.outputFormat, OutputFormat.Json);
    });

    it('prefers the flag over env and file', () => {
      const config = resolve({
        flags: { ndjson: true },
        env: { [ENV.Output]: OutputFormat.Json },
        file: { output: OutputFormat.Text },
      });
      assert.equal(config.outputFormat, OutputFormat.Ndjson);
    });

    it('ignores an empty env value rather than treating it as a choice', () => {
      const config = resolve({ env: { [ENV.Output]: '' }, file: { output: OutputFormat.Json } });
      assert.equal(config.outputFormat, OutputFormat.Json);
    });

    it('rejects conflicting format flags', () => {
      assert.throws(
        () => resolve({ flags: { json: true, ndjson: true } }),
        (error: unknown) =>
          error instanceof CliError &&
          error.errorCode === CliErrorCode.ConflictingOutputFormats,
      );
    });

    it('rejects an unrecognised env value instead of silently defaulting', () => {
      assert.throws(
        () => resolve({ env: { [ENV.Output]: 'yaml' } }),
        (error: unknown) =>
          error instanceof CliError &&
          error.errorCode === CliErrorCode.InvalidEnvironmentValue,
      );
    });
  });

  describe('log level', () => {
    it('defaults to info', () => {
      assert.equal(resolve().logLevel, LogLevel.Info);
    });

    it('follows the same flag > env > file > default order', () => {
      assert.equal(resolve({ file: { logLevel: LogLevel.Warn } }).logLevel, LogLevel.Warn);
      assert.equal(
        resolve({ env: { [ENV.LogLevel]: LogLevel.Debug }, file: { logLevel: LogLevel.Warn } })
          .logLevel,
        LogLevel.Debug,
      );
      assert.equal(
        resolve({ flags: { quiet: true }, env: { [ENV.LogLevel]: LogLevel.Debug } }).logLevel,
        LogLevel.Error,
      );
    });

    it('keeps errors visible under --quiet', () => {
      // Silencing progress must not silence the reason an investigation failed.
      assert.equal(resolve({ flags: { quiet: true } }).logLevel, LogLevel.Error);
    });

    it('rejects conflicting verbosity flags', () => {
      assert.throws(
        () => resolve({ flags: { verbose: true, quiet: true } }),
        (error: unknown) =>
          error instanceof CliError &&
          error.errorCode === CliErrorCode.ConflictingVerbosity,
      );
    });
  });

  describe('colour', () => {
    it('is on for an interactive text session', () => {
      assert.equal(resolve().color, true);
    });

    it('is off when stdout is not a terminal', () => {
      assert.equal(resolve({ isTty: false }).color, false);
    });

    it('is off for machine formats even on a terminal', () => {
      assert.equal(resolve({ flags: { json: true } }).color, false);
    });

    it('honours NO_COLOR by presence, whatever the value', () => {
      assert.equal(resolve({ env: { [ENV.NoColor]: '1' } }).color, false);
      assert.equal(resolve({ env: { [ENV.NoColor]: 'anything' } }).color, false);
    });

    it('treats an empty NO_COLOR as unset, per the convention', () => {
      assert.equal(resolve({ env: { [ENV.NoColor]: '' } }).color, true);
    });

    it('is off when --no-color is passed', () => {
      assert.equal(resolve({ flags: { color: false } }).color, false);
    });
  });

  describe('banner', () => {
    it('shows only in an interactive text session', () => {
      assert.equal(resolve().showBanner, true);
    });

    it('is suppressed when piped', () => {
      assert.equal(resolve({ isTty: false }).showBanner, false);
    });

    it('is suppressed for machine formats', () => {
      assert.equal(resolve({ flags: { json: true } }).showBanner, false);
      assert.equal(resolve({ flags: { ndjson: true } }).showBanner, false);
    });

    it('is suppressed when logging is silenced', () => {
      assert.equal(
        resolve({ env: { [ENV.LogLevel]: LogLevel.Silent } }).showBanner,
        false,
      );
    });
  });
});
