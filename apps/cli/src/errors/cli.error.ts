import { HeimdallError } from '@heimdall/core';
import { CliErrorCode } from './cli-error-code.enum';

export class CliError extends HeimdallError {
  override readonly errorCode: CliErrorCode;

  constructor(errorCode: CliErrorCode, message: string) {
    super(message);
    this.errorCode = errorCode;
  }
}
