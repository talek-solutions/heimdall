import { HeimdallError } from '@heimdall/core';
import { LlmErrorCode } from './llm-error-code.enum';

export class LlmError extends HeimdallError {
    override readonly errorCode: LlmErrorCode;

    constructor(
        errorCode: LlmErrorCode,
        message: string,
        options?: { readonly cause?: unknown },
    ) {
        super(message, options);
        this.errorCode = errorCode;
    }
}
