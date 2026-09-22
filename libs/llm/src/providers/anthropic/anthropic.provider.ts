import { LlmError, LlmErrorCode } from '../../errors';
import type { IAnthropicConfig } from '../../config/llm-config.model';
import type { LlmApiClient } from '../llm-api.client';
import type { ILLMProvider } from '../llm-provider.interface';
import { AnthropicApiKeyHeader, AnthropicBetaHeader, AnthropicVersionHeader } from './anthropic.constants';
import { AnthropicApiEndpoints } from './anthropic.enums';
import type { AnthropicProviderOptions } from './anthropic.options';
import type { AnthropicMessagesRequest } from './api/messages.request';
import type { AnthropicMessagesResponse } from './api/messages.response';
import type { AnthropicWireMessagesResponse } from './api/messages.wire';
import { toAnthropicRequest, type AnthropicChatRequest } from './mappers/chat-request.mapper';
import { fromAnthropicResponse, type AnthropicChatResponse } from './mappers/chat-response.mapper';
import { fromWireResponse, toWireRequest } from './mappers/messages-wire.mapper';

/** `chat()` is the port (ADR 0004); `messages()` is the Anthropic API itself. */
export class AnthropicProvider implements ILLMProvider<AnthropicProviderOptions, AnthropicMessagesResponse> {
    constructor(
        private readonly config: IAnthropicConfig,
        private readonly client: LlmApiClient,
    ) {}

    public async chat(request: AnthropicChatRequest): Promise<AnthropicChatResponse> {
        const response = await this.messages(toAnthropicRequest(request), request.providerOptions?.betas);
        return fromAnthropicResponse(response);
    }

    /** `betas` become the `anthropic-beta` header, required by e.g. `taskBudget`. */
    public async messages(
        request: AnthropicMessagesRequest,
        betas?: readonly string[],
    ): Promise<AnthropicMessagesResponse> {
        const apiKey = this.requireApiKey();

        const wire = await this.client.post<AnthropicWireMessagesResponse>({
            path: AnthropicApiEndpoints.MESSAGES,
            headers: {
                [AnthropicApiKeyHeader]: apiKey,
                [AnthropicVersionHeader]: this.config.apiVersion,
                ...(betas !== undefined && betas.length > 0 ? { [AnthropicBetaHeader]: betas.join(',') } : {}),
            },
            body: toWireRequest(request),
        });

        return fromWireResponse(wire);
    }

    /** Checked on use, not construction, so commands that never call the LLM still run. */
    private requireApiKey(): string {
        if (this.config.apiKey === undefined) {
            throw new LlmError(
                LlmErrorCode.MISSING_API_KEY,
                'ANTHROPIC_API_KEY is not set; export it or add it to .env',
            );
        }
        return this.config.apiKey;
    }
}
