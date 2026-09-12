import type { ErrorResponse } from './error-response.model';

/**
 * Base for every error Heimdall raises deliberately.
 *
 * Each functional area declares its own error-code enum and extends this, so a
 * failure always carries a stable machine-readable code rather than only a message
 * that callers would be tempted to string-match.
 */
export abstract class HeimdallError extends Error {
  abstract readonly errorCode: string;

  protected constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }

  toResponse(): ErrorResponse {
    return this.message === ''
      ? { errorCode: this.errorCode }
      : { errorCode: this.errorCode, message: this.message };
  }
}

export function isHeimdallError(error: unknown): error is HeimdallError {
  return error instanceof HeimdallError;
}
