import { HeimdallError } from '@heimdall/core';
import { ConfigErrorCode } from './config-error-code.enum';

export class ConfigError extends HeimdallError {
  override readonly errorCode: ConfigErrorCode;

  constructor(
    errorCode: ConfigErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.errorCode = errorCode;
  }
}
