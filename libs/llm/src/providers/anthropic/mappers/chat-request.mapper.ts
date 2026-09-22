import { LlmError, LlmErrorCode } from '../../../errors';
import {
    LLMContentPartType,
    LLMImageSourceType,
    LLMMessageRole,
    LLMReasoningEffort,
    LLMResponseFormatType,
    LLMToolChoiceType,
} from '../../interfaces/chat.enums';
import type { ILLMMessage, ILLMProviderMessageRequest, ILLMToolChoice, ILLMToolDefinition } from '../../interfaces/chat.request';
import type { ILLMImagePart, ILLMInputContentPart, ILLMToolResultPart } from '../../interfaces/chat.shared';
import { DEFAULT_ANTHROPIC_MAX_TOKENS } from '../anthropic.constants';
import { AnthropicModel } from '../anthropic.enums';
import type { AnthropicProviderOptions } from '../anthropic.options';
import {
    AnthropicContentBlockType,
    AnthropicEffort,
    AnthropicImageSourceType,
    AnthropicMessageRole,
    AnthropicOutputFormatType,
    AnthropicThinkingType,
    AnthropicToolChoiceType,
} from '../api/messages.enums';
import type {
    AnthropicMessageParam,
    AnthropicMessagesRequest,
    AnthropicOutputConfig,
    AnthropicSystemPrompt,
    AnthropicToolChoice,
    AnthropicToolDefinition,
    AnthropicToolInputSchema,
} from '../api/messages.request';
import type {
    AnthropicContentBlock,
    AnthropicImageBlock,
    AnthropicImageSource,
    AnthropicToolResultBlock,
} from '../api/messages.shared';

export type AnthropicChatRequest = ILLMProviderMessageRequest<AnthropicProviderOptions>;

const EFFORT_BY_REASONING: Readonly<Record<LLMReasoningEffort, AnthropicEffort>> = {
    [LLMReasoningEffort.LOW]: AnthropicEffort.LOW,
    [LLMReasoningEffort.MEDIUM]: AnthropicEffort.MEDIUM,
    [LLMReasoningEffort.HIGH]: AnthropicEffort.HIGH,
};

export function toAnthropicRequest(request: AnthropicChatRequest): AnthropicMessagesRequest {
    const options = request.providerOptions;
    const outputConfig = toOutputConfig(request, options);
    const thinking = options?.thinking ?? (request.reasoning !== undefined ? { type: AnthropicThinkingType.ADAPTIVE as const } : undefined);

    return {
        model: toModel(request.model),
        messages: toMessages(request.messages),
        maxTokens: request.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
        ...(request.system !== undefined ? { system: toSystem(request.system, options) } : {}),
        ...(request.metadata?.['userId'] !== undefined ? { metadata: { userId: request.metadata['userId'] } } : {}),
        ...(request.stopSequences !== undefined ? { stopSequences: request.stopSequences } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.topP !== undefined ? { topP: request.topP } : {}),
        ...(options?.topK !== undefined ? { topK: options.topK } : {}),
        ...(request.tools !== undefined ? { tools: request.tools.map(toTool) } : {}),
        ...(request.toolChoice !== undefined ? { toolChoice: toToolChoice(request.toolChoice) } : {}),
        ...(thinking !== undefined ? { thinking } : {}),
        ...(outputConfig !== undefined ? { outputConfig } : {}),
    };
}

function toModel(model: string): AnthropicModel {
    const known = Object.values(AnthropicModel) as string[];
    if (!known.includes(model)) {
        throw new LlmError(
            LlmErrorCode.UNSUPPORTED_REQUEST,
            `model '${model}' is not a known Anthropic model; expected one of ${known.join(', ')}`,
        );
    }
    return model as AnthropicModel;
}

function toSystem(system: string, options: AnthropicProviderOptions | undefined): AnthropicSystemPrompt {
    if (options?.systemCacheControl === undefined) {
        return system;
    }
    return [{ type: AnthropicContentBlockType.TEXT, text: system, cacheControl: options.systemCacheControl }];
}

/**
 * Anthropic has no tool role: results are `tool_result` blocks in a user
 * message, and consecutive TOOL messages merge into one turn (what the API
 * expects after a parallel tool call).
 */
function toMessages(messages: ILLMMessage[]): AnthropicMessageParam[] {
    const result: AnthropicMessageParam[] = [];

    for (const message of messages) {
        if (message.role !== LLMMessageRole.TOOL) {
            result.push({ role: toRole(message.role), content: toContent(message) });
            continue;
        }

        const blocks = toToolResultBlocks(message);
        const previous = result[result.length - 1];
        if (previous !== undefined && previous.role === AnthropicMessageRole.USER && Array.isArray(previous.content) && isToolResultOnly(previous.content)) {
            previous.content.push(...blocks);
        } else {
            result.push({ role: AnthropicMessageRole.USER, content: blocks });
        }
    }
    return result;
}

function toRole(role: LLMMessageRole.USER | LLMMessageRole.ASSISTANT): AnthropicMessageRole {
    return role === LLMMessageRole.USER ? AnthropicMessageRole.USER : AnthropicMessageRole.ASSISTANT;
}

function toContent(message: ILLMMessage): string | AnthropicContentBlock[] {
    if (typeof message.content === 'string') {
        return message.content;
    }
    return message.content.map((part) => toBlock(part, message.role));
}

function toToolResultBlocks(message: ILLMMessage): AnthropicToolResultBlock[] {
    if (typeof message.content === 'string') {
        throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, 'a TOOL message must carry TOOL_RESULT parts, not a plain string');
    }
    return message.content.map((part) => {
        if (part.type !== LLMContentPartType.TOOL_RESULT) {
            throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, `a TOOL message may only carry TOOL_RESULT parts, got '${part.type}'`);
        }
        return toToolResultBlock(part);
    });
}

function isToolResultOnly(blocks: AnthropicContentBlock[]): blocks is AnthropicToolResultBlock[] {
    return blocks.every((block) => block.type === AnthropicContentBlockType.TOOL_RESULT);
}

function toBlock(part: ILLMInputContentPart, role: LLMMessageRole): AnthropicContentBlock {
    switch (part.type) {
        case LLMContentPartType.TEXT:
            return { type: AnthropicContentBlockType.TEXT, text: part.text };
        case LLMContentPartType.IMAGE:
            return toImageBlock(part);
        case LLMContentPartType.TOOL_CALL:
            if (role !== LLMMessageRole.ASSISTANT) {
                throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, 'TOOL_CALL parts are only valid in ASSISTANT messages');
            }
            return { type: AnthropicContentBlockType.TOOL_USE, id: part.id, name: part.name, input: part.input };
        case LLMContentPartType.TOOL_RESULT:
            throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, 'TOOL_RESULT parts must be sent in a TOOL message');
    }
}

function toImageBlock(part: ILLMImagePart): AnthropicImageBlock {
    return { type: AnthropicContentBlockType.IMAGE, source: toImageSource(part.source) };
}

function toImageSource(source: ILLMImagePart['source']): AnthropicImageSource {
    switch (source.type) {
        case LLMImageSourceType.BASE64:
            return { type: AnthropicImageSourceType.BASE64, mediaType: source.mediaType, data: source.data };
        case LLMImageSourceType.URL:
            return { type: AnthropicImageSourceType.URL, url: source.url };
    }
}

function toToolResultBlock(part: ILLMToolResultPart): AnthropicToolResultBlock {
    return {
        type: AnthropicContentBlockType.TOOL_RESULT,
        toolUseId: part.toolCallId,
        content:
            typeof part.content === 'string'
                ? part.content
                : part.content.map((inner) =>
                      inner.type === LLMContentPartType.TEXT
                          ? { type: AnthropicContentBlockType.TEXT as const, text: inner.text }
                          : toImageBlock(inner),
                  ),
        ...(part.isError !== undefined ? { isError: part.isError } : {}),
    };
}

function toTool(tool: ILLMToolDefinition): AnthropicToolDefinition {
    if (tool.inputSchema['type'] !== 'object') {
        throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, `tool '${tool.name}' inputSchema must be a JSON Schema of type 'object'`);
    }
    return {
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as AnthropicToolInputSchema,
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    };
}

function toToolChoice(choice: ILLMToolChoice): AnthropicToolChoice {
    switch (choice.type) {
        case LLMToolChoiceType.AUTO:
            return { type: AnthropicToolChoiceType.AUTO };
        case LLMToolChoiceType.NONE:
            return { type: AnthropicToolChoiceType.NONE };
        case LLMToolChoiceType.REQUIRED:
            return { type: AnthropicToolChoiceType.ANY };
        case LLMToolChoiceType.TOOL:
            return { type: AnthropicToolChoiceType.TOOL, name: choice.name };
    }
}

function toOutputConfig(request: AnthropicChatRequest, options: AnthropicProviderOptions | undefined): AnthropicOutputConfig | undefined {
    const effort = options?.effort ?? (request.reasoning?.effort !== undefined ? EFFORT_BY_REASONING[request.reasoning.effort] : undefined);
    const format =
        request.responseFormat?.type === LLMResponseFormatType.JSON_SCHEMA
            ? { type: AnthropicOutputFormatType.JSON_SCHEMA, schema: request.responseFormat.schema }
            : undefined;

    const config: AnthropicOutputConfig = {
        ...(effort !== undefined ? { effort } : {}),
        ...(options?.taskBudget !== undefined ? { taskBudget: options.taskBudget } : {}),
        ...(format !== undefined ? { format } : {}),
    };
    return Object.keys(config).length === 0 ? undefined : config;
}
