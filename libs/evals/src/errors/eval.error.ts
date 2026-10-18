import { HeimdallError } from '@heimdall/core';
import { EvalErrorCode } from './eval-error-code.enum';

export class EvalError extends HeimdallError {
  override readonly errorCode: EvalErrorCode;

  constructor(errorCode: EvalErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.errorCode = errorCode;
  }
}
