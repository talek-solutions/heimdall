import type { Provider } from '@nestjs/common';
import type { ILlmConfig } from '../config/llm-config.model';
import { LlmError, LlmErrorCode } from '../errors';
import { LlmProviderKind } from '../llm.enums';
import { LLM_CONFIG, LLM_PROVIDER } from '../llm.tokens';
import { AnthropicProvider } from './anthropic/anthropic.provider';
import { LlmApiClient } from './llm-api.client';
import type { ILLMProvider } from './llm-provider.interface';

/** Adding a provider = a `LlmProviderKind` member + a case here (`never` enforces it). */
export const llmProvider: Provider<ILLMProvider> = {
    provide: LLM_PROVIDER,
    inject: [LLM_CONFIG],
    useFactory: (config: ILlmConfig): ILLMProvider => createLlmProvider(config),
};

export function createLlmProvider(config: ILlmConfig): ILLMProvider {
    switch (config.preferredProvider) {
        case LlmProviderKind.ANTHROPIC:
            return new AnthropicProvider(
                config.anthropic,
                new LlmApiClient({ apiUrl: config.anthropic.apiUrl }),
            );
        default: {
            const unhandled: never = config.preferredProvider;
            throw new LlmError(
                LlmErrorCode.INVALID_PROVIDER,
                `no adapter registered for provider '${String(unhandled)}'`,
            );
        }
    }
}
