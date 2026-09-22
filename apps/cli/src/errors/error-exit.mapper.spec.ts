import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import { LlmError, LlmErrorCode } from '@heimdall/llm';
import { ConfigError, ConfigErrorCode } from '@heimdall/telemetry';
import { CliError } from './cli.error';
import { CliErrorCode } from './cli-error-code.enum';
import { exitCodeForError, toErrorResponse } from './error-exit.mapper';

describe('exitCodeForError', () => {
  it('maps CLI and config errors to Usage', () => {
    assert.equal(
      exitCodeForError(new CliError(CliErrorCode.ConflictingVerbosity, 'x')),
      ExitCode.Usage,
    );
    assert.equal(
      exitCodeForError(new ConfigError(ConfigErrorCode.ConfigInvalid, 'x')),
      ExitCode.Usage,
    );
  });

  it('maps an invalid LLM provider selection to Usage', () => {
    assert.equal(
      exitCodeForError(new LlmError(LlmErrorCode.INVALID_PROVIDER, 'x')),
      ExitCode.Usage,
    );
  });

  it('maps missing or rejected LLM credentials to ProviderAuth', () => {
    assert.equal(
      exitCodeForError(new LlmError(LlmErrorCode.MISSING_API_KEY, 'x')),
      ExitCode.ProviderAuth,
    );
    assert.equal(
      exitCodeForError(new LlmError(LlmErrorCode.AUTHENTICATION_FAILED, 'x')),
      ExitCode.ProviderAuth,
    );
  });

  it('maps every other LLM failure and non-Heimdall errors to Unexpected', () => {
    assert.equal(
      exitCodeForError(new LlmError(LlmErrorCode.RATE_LIMITED, 'x')),
      ExitCode.Unexpected,
    );
    assert.equal(exitCodeForError(new Error('boom')), ExitCode.Unexpected);
  });
});

describe('toErrorResponse', () => {
  it('uses the error code contract for Heimdall errors', () => {
    assert.deepEqual(
      toErrorResponse(new LlmError(LlmErrorCode.MISSING_API_KEY, 'set the key')),
      { errorCode: 'LLM_MISSING_API_KEY', message: 'set the key' },
    );
  });

  it('wraps anything else as UNEXPECTED_ERROR', () => {
    assert.deepEqual(toErrorResponse(new Error('boom')), {
      errorCode: 'UNEXPECTED_ERROR',
      message: 'boom',
    });
  });
});
