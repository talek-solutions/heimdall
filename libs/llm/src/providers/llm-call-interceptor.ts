import type { ILLMProviderMessageRequest } from './interfaces/chat.request';
import type { ILLMProviderMessageResponse } from './interfaces/chat.response';
import type { ILLMProvider } from './llm-provider.interface';

export type LlmChatCall = (request: ILLMProviderMessageRequest) => Promise<ILLMProviderMessageResponse>;

/**
 * Sees every model call before the provider does: records it, or answers it from a recording
 * (ADR 0007). Optional; with none bound, the provider is used as is.
 */
export interface ILLMCallInterceptor {
    chat(request: ILLMProviderMessageRequest, next: LlmChatCall): Promise<ILLMProviderMessageResponse>;
}

/** The provider, with every call passed through the interceptor. */
export function interceptLlmProvider(provider: ILLMProvider, interceptor: ILLMCallInterceptor | undefined): ILLMProvider {
    if (interceptor === undefined) {
        return provider;
    }
    return {
        chat: (request) => interceptor.chat(request, (forwarded) => provider.chat(forwarded)),
    };
}
