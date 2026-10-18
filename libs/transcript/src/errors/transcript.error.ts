import { HeimdallError } from '@heimdall/core';
import { TranscriptErrorCode } from './transcript-error-code.enum';

export class TranscriptError extends HeimdallError {
  override readonly errorCode: TranscriptErrorCode;

  constructor(
    errorCode: TranscriptErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.errorCode = errorCode;
  }
}

/** A recorded failure with a code no library here owns, raised again as it was. */
export class ReplayedError extends HeimdallError {
  constructor(
    override readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}
