import type { ILLMProviderMessageRequest } from './interfaces/chat.request';
import type { ILLMProviderMessageResponse } from './interfaces/chat.response';

/** The LLM port (ADR 0004). Adapters narrow the generics to their own types. */
export interface ILLMProvider<TProviderOptions = Record<string, unknown>, TRaw = unknown> {
    chat(
        request: ILLMProviderMessageRequest<TProviderOptions>,
    ): Promise<ILLMProviderMessageResponse<TRaw>>;
}
