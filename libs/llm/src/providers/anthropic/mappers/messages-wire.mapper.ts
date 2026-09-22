/**
 * Field-by-field camelCase <-> snake_case. Deliberately not a generic key-case
 * transform: tool `input`, `input_schema` and output `schema` are caller-owned
 * JSON whose keys must survive byte for byte.
 */

import { LlmError, LlmErrorCode } from '../../../errors';
import {
    AnthropicContentBlockType,
    AnthropicImageSourceType,
    AnthropicThinkingType,
    AnthropicToolChoiceType,
} from '../api/messages.enums';
import type {
    AnthropicMessageParam,
    AnthropicMessagesRequest,
    AnthropicOutputConfig,
    AnthropicSystemPrompt,
    AnthropicThinkingConfig,
    AnthropicToolChoice,
    AnthropicToolDefinition,
} from '../api/messages.request';
import type { AnthropicMessagesResponse, AnthropicStopDetails } from '../api/messages.response';
import type {
    AnthropicCacheControl,
    AnthropicContentBlock,
    AnthropicImageSource,
    AnthropicTextBlock,
    AnthropicToolResultContent,
    AnthropicUsage,
} from '../api/messages.shared';
import type {
    AnthropicWireCacheControl,
    AnthropicWireContentBlock,
    AnthropicWireImageSource,
    AnthropicWireMessageParam,
    AnthropicWireMessagesRequest,
    AnthropicWireMessagesResponse,
    AnthropicWireOutputConfig,
    AnthropicWireStopDetails,
    AnthropicWireTextBlock,
    AnthropicWireThinkingConfig,
    AnthropicWireToolChoice,
    AnthropicWireToolDefinition,
    AnthropicWireToolResultContent,
    AnthropicWireUsage,
} from '../api/messages.wire';

export function toWireRequest(request: AnthropicMessagesRequest): AnthropicWireMessagesRequest {
    return {
        model: request.model,
        messages: request.messages.map(toWireMessage),
        max_tokens: request.maxTokens,
        ...(request.system !== undefined ? { system: toWireSystem(request.system) } : {}),
        ...(request.metadata?.userId !== undefined
            ? { metadata: { user_id: request.metadata.userId } }
            : {}),
        ...(request.stopSequences !== undefined ? { stop_sequences: request.stopSequences } : {}),
        ...(request.stream !== undefined ? { stream: request.stream } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topK !== undefined ? { top_k: request.topK } : {}),
        ...(request.topP !== undefined ? { top_p: request.topP } : {}),
        ...(request.tools !== undefined ? { tools: request.tools.map(toWireTool) } : {}),
        ...(request.toolChoice !== undefined ? { tool_choice: toWireToolChoice(request.toolChoice) } : {}),
        ...(request.thinking !== undefined ? { thinking: toWireThinking(request.thinking) } : {}),
        ...(request.outputConfig !== undefined
            ? { output_config: toWireOutputConfig(request.outputConfig) }
            : {}),
    };
}

export function fromWireResponse(wire: AnthropicWireMessagesResponse): AnthropicMessagesResponse {
    assertResponseShape(wire);

    return {
        id: wire.id,
        type: wire.type,
        role: wire.role,
        content: wire.content.map(fromWireBlock),
        model: wire.model,
        stopReason: wire.stop_reason,
        stopSequence: wire.stop_sequence,
        stopDetails: fromWireStopDetails(wire.stop_details),
        usage: fromWireUsage(wire.usage),
    };
}

function toWireSystem(system: AnthropicSystemPrompt): string | AnthropicWireTextBlock[] {
    return typeof system === 'string' ? system : system.map(toWireTextBlock);
}

function toWireMessage(message: AnthropicMessageParam): AnthropicWireMessageParam {
    return {
        role: message.role,
        content:
            typeof message.content === 'string'
                ? message.content
                : message.content.map(toWireBlock),
    };
}

function toWireCacheControl(cacheControl: AnthropicCacheControl): AnthropicWireCacheControl {
    return {
        type: cacheControl.type,
        ...(cacheControl.ttl !== undefined ? { ttl: cacheControl.ttl } : {}),
    };
}

function toWireTextBlock(block: AnthropicTextBlock): AnthropicWireTextBlock {
    return {
        type: block.type,
        text: block.text,
        ...(block.cacheControl !== undefined
            ? { cache_control: toWireCacheControl(block.cacheControl) }
            : {}),
    };
}

function toWireImageSource(source: AnthropicImageSource): AnthropicWireImageSource {
    switch (source.type) {
        case AnthropicImageSourceType.BASE64:
            return { type: source.type, media_type: source.mediaType, data: source.data };
        case AnthropicImageSourceType.URL:
            return { type: source.type, url: source.url };
    }
}

function toWireToolResultContent(
    content: string | AnthropicToolResultContent[],
): string | AnthropicWireToolResultContent[] {
    if (typeof content === 'string') {
        return content;
    }
    return content.map((block) =>
        block.type === AnthropicContentBlockType.TEXT
            ? toWireTextBlock(block)
            : toWireImageBlock(block),
    );
}

function toWireImageBlock(
    block: Extract<AnthropicContentBlock, { type: AnthropicContentBlockType.IMAGE }>,
): Extract<AnthropicWireContentBlock, { type: AnthropicContentBlockType.IMAGE }> {
    return {
        type: block.type,
        source: toWireImageSource(block.source),
        ...(block.cacheControl !== undefined
            ? { cache_control: toWireCacheControl(block.cacheControl) }
            : {}),
    };
}

function toWireBlock(block: AnthropicContentBlock): AnthropicWireContentBlock {
    switch (block.type) {
        case AnthropicContentBlockType.TEXT:
            return toWireTextBlock(block);
        case AnthropicContentBlockType.THINKING:
            return {
                type: block.type,
                thinking: block.thinking,
                ...(block.signature !== undefined ? { signature: block.signature } : {}),
            };
        case AnthropicContentBlockType.REDACTED_THINKING:
            return { type: block.type, data: block.data };
        case AnthropicContentBlockType.TOOL_USE:
            return { type: block.type, id: block.id, name: block.name, input: block.input };
        case AnthropicContentBlockType.TOOL_RESULT:
            return {
                type: block.type,
                tool_use_id: block.toolUseId,
                content: toWireToolResultContent(block.content),
                ...(block.isError !== undefined ? { is_error: block.isError } : {}),
                ...(block.cacheControl !== undefined
                    ? { cache_control: toWireCacheControl(block.cacheControl) }
                    : {}),
            };
        case AnthropicContentBlockType.IMAGE:
            return toWireImageBlock(block);
    }
}

function toWireTool(tool: AnthropicToolDefinition): AnthropicWireToolDefinition {
    return {
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        input_schema: tool.inputSchema,
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    };
}

function toWireToolChoice(choice: AnthropicToolChoice): AnthropicWireToolChoice {
    switch (choice.type) {
        case AnthropicToolChoiceType.NONE:
            return { type: choice.type };
        case AnthropicToolChoiceType.TOOL:
            return {
                type: choice.type,
                name: choice.name,
                ...(choice.disableParallelToolUse !== undefined
                    ? { disable_parallel_tool_use: choice.disableParallelToolUse }
                    : {}),
            };
        case AnthropicToolChoiceType.AUTO:
        case AnthropicToolChoiceType.ANY:
            return {
                type: choice.type,
                ...(choice.disableParallelToolUse !== undefined
                    ? { disable_parallel_tool_use: choice.disableParallelToolUse }
                    : {}),
            };
    }
}

function toWireThinking(thinking: AnthropicThinkingConfig): AnthropicWireThinkingConfig {
    switch (thinking.type) {
        case AnthropicThinkingType.ADAPTIVE:
            return {
                type: thinking.type,
                ...(thinking.display !== undefined ? { display: thinking.display } : {}),
            };
        case AnthropicThinkingType.ENABLED:
            return { type: thinking.type, budget_tokens: thinking.budgetTokens };
        case AnthropicThinkingType.DISABLED:
            return { type: thinking.type };
    }
}

function toWireOutputConfig(config: AnthropicOutputConfig): AnthropicWireOutputConfig {
    return {
        ...(config.effort !== undefined ? { effort: config.effort } : {}),
        ...(config.taskBudget !== undefined
            ? {
                  task_budget: {
                      type: config.taskBudget.type,
                      total: config.taskBudget.total,
                      ...(config.taskBudget.remaining !== undefined
                          ? { remaining: config.taskBudget.remaining }
                          : {}),
                  },
              }
            : {}),
        ...(config.format !== undefined
            ? {
                  format: {
                      type: config.format.type,
                      ...(config.format.schema !== undefined ? { schema: config.format.schema } : {}),
                  },
              }
            : {}),
    };
}

function fromWireCacheControl(cacheControl: AnthropicWireCacheControl): AnthropicCacheControl {
    return {
        type: cacheControl.type,
        ...(cacheControl.ttl !== undefined ? { ttl: cacheControl.ttl } : {}),
    };
}

function fromWireTextBlock(block: AnthropicWireTextBlock): AnthropicTextBlock {
    return {
        type: block.type,
        text: block.text,
        ...(block.cache_control !== undefined
            ? { cacheControl: fromWireCacheControl(block.cache_control) }
            : {}),
    };
}

function fromWireImageSource(source: AnthropicWireImageSource): AnthropicImageSource {
    switch (source.type) {
        case AnthropicImageSourceType.BASE64:
            return { type: source.type, mediaType: source.media_type, data: source.data };
        case AnthropicImageSourceType.URL:
            return { type: source.type, url: source.url };
    }
}

function fromWireToolResultContent(
    content: string | AnthropicWireToolResultContent[],
): string | AnthropicToolResultContent[] {
    if (typeof content === 'string') {
        return content;
    }
    return content.map((block) =>
        block.type === AnthropicContentBlockType.TEXT
            ? fromWireTextBlock(block)
            : fromWireImageBlock(block),
    );
}

function fromWireImageBlock(
    block: Extract<AnthropicWireContentBlock, { type: AnthropicContentBlockType.IMAGE }>,
): Extract<AnthropicContentBlock, { type: AnthropicContentBlockType.IMAGE }> {
    return {
        type: block.type,
        source: fromWireImageSource(block.source),
        ...(block.cache_control !== undefined
            ? { cacheControl: fromWireCacheControl(block.cache_control) }
            : {}),
    };
}

function fromWireBlock(block: AnthropicWireContentBlock): AnthropicContentBlock {
    switch (block.type) {
        case AnthropicContentBlockType.TEXT:
            return fromWireTextBlock(block);
        case AnthropicContentBlockType.THINKING:
            return {
                type: block.type,
                thinking: block.thinking,
                ...(block.signature !== undefined ? { signature: block.signature } : {}),
            };
        case AnthropicContentBlockType.REDACTED_THINKING:
            return { type: block.type, data: block.data };
        case AnthropicContentBlockType.TOOL_USE:
            return { type: block.type, id: block.id, name: block.name, input: block.input };
        case AnthropicContentBlockType.TOOL_RESULT:
            return {
                type: block.type,
                toolUseId: block.tool_use_id,
                content: fromWireToolResultContent(block.content),
                ...(block.is_error !== undefined ? { isError: block.is_error } : {}),
                ...(block.cache_control !== undefined
                    ? { cacheControl: fromWireCacheControl(block.cache_control) }
                    : {}),
            };
        case AnthropicContentBlockType.IMAGE:
            return fromWireImageBlock(block);
        default:
            throw new LlmError(
                LlmErrorCode.INVALID_RESPONSE,
                `unknown content block type '${String((block as { type: unknown }).type)}'`,
            );
    }
}

function fromWireStopDetails(
    details: AnthropicWireStopDetails | null | undefined,
): AnthropicStopDetails | null {
    if (details === null || details === undefined) {
        return null;
    }
    return {
        type: details.type,
        ...(details.category !== undefined ? { category: details.category } : {}),
        ...(details.explanation !== undefined ? { explanation: details.explanation } : {}),
    };
}

function fromWireUsage(usage: AnthropicWireUsage): AnthropicUsage {
    return {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        ...(typeof usage.cache_creation_input_tokens === 'number'
            ? { cacheCreationInputTokens: usage.cache_creation_input_tokens }
            : {}),
        ...(typeof usage.cache_read_input_tokens === 'number'
            ? { cacheReadInputTokens: usage.cache_read_input_tokens }
            : {}),
    };
}

/** The wire type is a compile-time promise; the body came off the network. */
function assertResponseShape(wire: unknown): asserts wire is AnthropicWireMessagesResponse {
    const record = (typeof wire === 'object' && wire !== null ? wire : {}) as Record<string, unknown>;
    const usage = record['usage'];

    const valid =
        typeof record['id'] === 'string' &&
        Array.isArray(record['content']) &&
        typeof usage === 'object' &&
        usage !== null &&
        typeof (usage as Record<string, unknown>)['input_tokens'] === 'number' &&
        typeof (usage as Record<string, unknown>)['output_tokens'] === 'number';

    if (!valid) {
        throw new LlmError(
            LlmErrorCode.INVALID_RESPONSE,
            'response is missing id, content or usage token counts',
        );
    }
}
