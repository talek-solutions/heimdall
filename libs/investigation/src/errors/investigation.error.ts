import { HeimdallError } from '@heimdall/core';
import type { IEntryCandidate } from '../interfaces/investigation-plan.interface';
import { InvestigationErrorCode } from './investigation-error-code.enum';

export class InvestigationError extends HeimdallError {
  override readonly errorCode: InvestigationErrorCode;

  constructor(
    errorCode: InvestigationErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.errorCode = errorCode;
  }
}

/** Carries the candidates so a caller that can ask the engineer has something to offer. */
export class AmbiguousEntryError extends InvestigationError {
  constructor(readonly candidates: readonly IEntryCandidate[]) {
    super(
      InvestigationErrorCode.EntryAmbiguous,
      `the report fits several entries about equally: ${candidates
        .map(({ vertex, confidence }) => `${vertex} (${confidence.toFixed(2)})`)
        .join(', ')}; name one as the entry (--entry)`,
    );
  }
}
