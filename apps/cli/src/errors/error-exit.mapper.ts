import { ExitCode, isHeimdallError, type ErrorResponse } from '@heimdall/core';
import { LlmErrorCode } from '@heimdall/llm';
import { ConfigErrorCode } from '@heimdall/config';
import { CliErrorCode } from './cli-error-code.enum';

/**
 * Error codes that mean "the invocation or its configuration was wrong", as
 * opposed to "something broke". Both are failures; only these are the user's to
 * fix, and .docs/adr/0006 gives them exit code 2 so a pipeline can tell them apart.
 */
const USAGE_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.values(ConfigErrorCode),
  ...Object.values(CliErrorCode),
  LlmErrorCode.INVALID_PROVIDER,
]);

/** Missing or rejected credentials: .docs/adr/0006 reserves exit code 4 for these. */
const PROVIDER_AUTH_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  LlmErrorCode.MISSING_API_KEY,
  LlmErrorCode.AUTHENTICATION_FAILED,
]);

export function exitCodeForError(error: unknown): ExitCode {
  if (!isHeimdallError(error)) {
    return ExitCode.Unexpected;
  }
  if (USAGE_ERROR_CODES.has(error.errorCode)) {
    return ExitCode.Usage;
  }
  if (PROVIDER_AUTH_ERROR_CODES.has(error.errorCode)) {
    return ExitCode.ProviderAuth;
  }
  return ExitCode.Unexpected;
}

export function toErrorResponse(error: unknown): ErrorResponse {
  if (isHeimdallError(error)) {
    return error.toResponse();
  }
  return {
    errorCode: 'UNEXPECTED_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
