import { HeimdallError } from '../../errors/heimdall.error';
import { ManifestErrorCode } from './manifest-error-code.enum';

export class ManifestError extends HeimdallError {
  override readonly errorCode: ManifestErrorCode;

  constructor(
    errorCode: ManifestErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.errorCode = errorCode;
  }
}
