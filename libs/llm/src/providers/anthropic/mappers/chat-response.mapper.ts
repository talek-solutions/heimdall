import { LLMContentPartType, LLMFinishReason, LLMMessageRole } from '../../interfaces/chat.enums';
import type { ILLMProviderMessageResponse } from '../../interfaces/chat.response';
import type { ILLMOutputContentPart } from '../../interfaces/chat.shared';
import { AnthropicContentBlockType, AnthropicStopReason } from '../api/messages.enums';
import type { AnthropicMessagesResponse } from '../api/messages.response';
import type { AnthropicContentBlock } from '../api/messages.shared';

export type AnthropicChatResponse = ILLMProviderMessageResponse<AnthropicMessagesResponse>;

const FINISH_REASON_BY_STOP_REASON: Readonly<Record<AnthropicStopReason, LLMFinishReason>> = {
    [AnthropicStopReason.END_TURN]: LLMFinishReason.STOP,
    [AnthropicStopReason.STOP_SEQUENCE]: LLMFinishReason.STOP,
    [AnthropicStopReason.MAX_TOKENS]: LLMFinishReason.LENGTH,
    [AnthropicStopReason.TOOL_USE]: LLMFinishReason.TOOL_CALLS,
    [AnthropicStopReason.REFUSAL]: LLMFinishReason.CONTENT_FILTER,
    [AnthropicStopReason.PAUSE_TURN]: LLMFinishReason.OTHER,
};

export function fromAnthropicResponse(response: AnthropicMessagesResponse): AnthropicChatResponse {
    return {
        id: response.id,
        model: response.model,
        role: LLMMessageRole.ASSISTANT,
        content: response.content.flatMap(toOutputPart),
        finishReason:
            response.stopReason === null
                ? LLMFinishReason.OTHER
                : (FINISH_REASON_BY_STOP_REASON[response.stopReason] ?? LLMFinishReason.OTHER),
        usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            ...(response.usage.cacheReadInputTokens !== undefined
                ? { cachedInputTokens: response.usage.cacheReadInputTokens }
                : {}),
        },
        raw: response,
    };
}

function toOutputPart(block: AnthropicContentBlock): ILLMOutputContentPart[] {
    switch (block.type) {
        case AnthropicContentBlockType.TEXT:
            return [{ type: LLMContentPartType.TEXT, text: block.text }];
        case AnthropicContentBlockType.TOOL_USE:
            return [{ type: LLMContentPartType.TOOL_CALL, id: block.id, name: block.name, input: block.input }];
        case AnthropicContentBlockType.THINKING:
            return [{ type: LLMContentPartType.REASONING, text: block.thinking }];
        // No abstract counterpart; available via `raw`.
        case AnthropicContentBlockType.REDACTED_THINKING:
        case AnthropicContentBlockType.TOOL_RESULT:
        case AnthropicContentBlockType.IMAGE:
            return [];
    }
}
