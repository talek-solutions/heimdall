/**
 * Shapes shared by BOTH the Messages API request and response.
 *
 * Content blocks are the primary shared surface: they appear as message content
 * on the request and as response content on the reply.
 */

import {
    AnthropicCacheControlType,
    AnthropicContentBlockType,
    AnthropicImageSourceType,
} from './messages.enums';

export interface AnthropicCacheControl {
    type: AnthropicCacheControlType;
    /** e.g. '1h'. Omit for the default 5-minute TTL. */
    ttl?: string;
}

export interface AnthropicTextBlock {
    type: AnthropicContentBlockType.TEXT;
    text: string;
    cacheControl?: AnthropicCacheControl;
}

export interface AnthropicThinkingBlock {
    type: AnthropicContentBlockType.THINKING;
    thinking: string;
    signature?: string;
}

export interface AnthropicRedactedThinkingBlock {
    type: AnthropicContentBlockType.REDACTED_THINKING;
    data: string;
}

export interface AnthropicToolUseBlock {
    type: AnthropicContentBlockType.TOOL_USE;
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface AnthropicBase64ImageSource {
    type: AnthropicImageSourceType.BASE64;
    mediaType: string;
    data: string;
}

export interface AnthropicUrlImageSource {
    type: AnthropicImageSourceType.URL;
    url: string;
}

export type AnthropicImageSource =
    | AnthropicBase64ImageSource
    | AnthropicUrlImageSource;

export interface AnthropicImageBlock {
    type: AnthropicContentBlockType.IMAGE;
    source: AnthropicImageSource;
    cacheControl?: AnthropicCacheControl;
}

/** Content permitted inside a tool_result block (text or image only). */
export type AnthropicToolResultContent =
    | AnthropicTextBlock
    | AnthropicImageBlock;

export interface AnthropicToolResultBlock {
    type: AnthropicContentBlockType.TOOL_RESULT;
    toolUseId: string;
    content: string | AnthropicToolResultContent[];
    isError?: boolean;
    cacheControl?: AnthropicCacheControl;
}

export type AnthropicContentBlock =
    | AnthropicTextBlock
    | AnthropicThinkingBlock
    | AnthropicRedactedThinkingBlock
    | AnthropicToolUseBlock
    | AnthropicToolResultBlock
    | AnthropicImageBlock;

export interface AnthropicUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
}
