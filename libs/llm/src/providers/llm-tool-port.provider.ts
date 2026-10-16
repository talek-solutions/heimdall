import type { Provider } from '@nestjs/common';
import type { ILlmConfig } from '../config/llm-config.model';
import { LlmError, LlmErrorCode } from '../errors';
import { LlmProviderKind } from '../llm.enums';
import { LLM_CONFIG, LLM_TOOL_PORT } from '../llm.tokens';
import { AnthropicToolPort } from './anthropic/anthropic.tool-port';
import type { ILLMToolPort } from './interfaces/tool-port.interface';

/** Follows `llmProvider`: the port always matches the provider that will receive the tools. */
export const llmToolPort: Provider<ILLMToolPort> = {
    provide: LLM_TOOL_PORT,
    inject: [LLM_CONFIG],
    useFactory: (config: ILlmConfig): ILLMToolPort => createLlmToolPort(config),
};

export function createLlmToolPort(config: ILlmConfig): ILLMToolPort {
    switch (config.preferredProvider) {
        case LlmProviderKind.ANTHROPIC:
            return new AnthropicToolPort();
        default: {
            const unhandled: never = config.preferredProvider;
            throw new LlmError(
                LlmErrorCode.INVALID_PROVIDER,
                `no tool port registered for provider '${String(unhandled)}'`,
            );
        }
    }
}
