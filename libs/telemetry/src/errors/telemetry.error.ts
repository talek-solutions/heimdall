import { HeimdallError } from '@heimdall/core';
import { TelemetryErrorCode } from './telemetry-error-code.enum';

export class TelemetryError extends HeimdallError {
  override readonly errorCode: TelemetryErrorCode;

  constructor(
    errorCode: TelemetryErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.errorCode = errorCode;
  }
}
