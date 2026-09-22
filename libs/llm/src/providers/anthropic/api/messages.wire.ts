/**
 * Literal snake_case wire shapes of the Anthropic Messages API. The camelCase
 * `messages.request.ts` / `messages.response.ts` types are the working model;
 * `mappers/messages-wire.mapper.ts` converts between the two.
 */

import {
    AnthropicCacheControlType,
    AnthropicContentBlockType,
    AnthropicEffort,
    AnthropicImageSourceType,
    AnthropicMessageRole,
    AnthropicMessageType,
    AnthropicOutputFormatType,
    AnthropicRefusalCategory,
    AnthropicStopReason,
    AnthropicTaskBudgetType,
    AnthropicThinkingDisplay,
    AnthropicThinkingType,
    AnthropicToolChoiceType,
} from './messages.enums';
import type { AnthropicToolInputSchema } from './messages.request';

export interface AnthropicWireCacheControl {
    type: AnthropicCacheControlType;
    ttl?: string;
}

export interface AnthropicWireTextBlock {
    type: AnthropicContentBlockType.TEXT;
    text: string;
    cache_control?: AnthropicWireCacheControl;
}

export interface AnthropicWireThinkingBlock {
    type: AnthropicContentBlockType.THINKING;
    thinking: string;
    signature?: string;
}

export interface AnthropicWireRedactedThinkingBlock {
    type: AnthropicContentBlockType.REDACTED_THINKING;
    data: string;
}

export interface AnthropicWireToolUseBlock {
    type: AnthropicContentBlockType.TOOL_USE;
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface AnthropicWireBase64ImageSource {
    type: AnthropicImageSourceType.BASE64;
    media_type: string;
    data: string;
}

export interface AnthropicWireUrlImageSource {
    type: AnthropicImageSourceType.URL;
    url: string;
}

export type AnthropicWireImageSource =
    | AnthropicWireBase64ImageSource
    | AnthropicWireUrlImageSource;

export interface AnthropicWireImageBlock {
    type: AnthropicContentBlockType.IMAGE;
    source: AnthropicWireImageSource;
    cache_control?: AnthropicWireCacheControl;
}

export type AnthropicWireToolResultContent =
    | AnthropicWireTextBlock
    | AnthropicWireImageBlock;

export interface AnthropicWireToolResultBlock {
    type: AnthropicContentBlockType.TOOL_RESULT;
    tool_use_id: string;
    content: string | AnthropicWireToolResultContent[];
    is_error?: boolean;
    cache_control?: AnthropicWireCacheControl;
}

export type AnthropicWireContentBlock =
    | AnthropicWireTextBlock
    | AnthropicWireThinkingBlock
    | AnthropicWireRedactedThinkingBlock
    | AnthropicWireToolUseBlock
    | AnthropicWireToolResultBlock
    | AnthropicWireImageBlock;

export interface AnthropicWireMessageParam {
    role: AnthropicMessageRole;
    content: string | AnthropicWireContentBlock[];
}

export interface AnthropicWireToolDefinition {
    name: string;
    description?: string;
    input_schema: AnthropicToolInputSchema;
    strict?: boolean;
}

export interface AnthropicWireAutoToolChoice {
    type: AnthropicToolChoiceType.AUTO;
    disable_parallel_tool_use?: boolean;
}

export interface AnthropicWireAnyToolChoice {
    type: AnthropicToolChoiceType.ANY;
    disable_parallel_tool_use?: boolean;
}

export interface AnthropicWireSpecificToolChoice {
    type: AnthropicToolChoiceType.TOOL;
    name: string;
    disable_parallel_tool_use?: boolean;
}

export interface AnthropicWireNoneToolChoice {
    type: AnthropicToolChoiceType.NONE;
}

export type AnthropicWireToolChoice =
    | AnthropicWireAutoToolChoice
    | AnthropicWireAnyToolChoice
    | AnthropicWireSpecificToolChoice
    | AnthropicWireNoneToolChoice;

export interface AnthropicWireAdaptiveThinkingConfig {
    type: AnthropicThinkingType.ADAPTIVE;
    display?: AnthropicThinkingDisplay;
}

export interface AnthropicWireEnabledThinkingConfig {
    type: AnthropicThinkingType.ENABLED;
    budget_tokens: number;
}

export interface AnthropicWireDisabledThinkingConfig {
    type: AnthropicThinkingType.DISABLED;
}

export type AnthropicWireThinkingConfig =
    | AnthropicWireAdaptiveThinkingConfig
    | AnthropicWireEnabledThinkingConfig
    | AnthropicWireDisabledThinkingConfig;

export interface AnthropicWireTaskBudget {
    type: AnthropicTaskBudgetType;
    total: number;
    remaining?: number;
}

export interface AnthropicWireOutputFormat {
    type: AnthropicOutputFormatType;
    schema?: Record<string, unknown>;
}

export interface AnthropicWireOutputConfig {
    effort?: AnthropicEffort;
    task_budget?: AnthropicWireTaskBudget;
    format?: AnthropicWireOutputFormat;
}

export interface AnthropicWireRequestMetadata {
    user_id?: string;
}

export interface AnthropicWireMessagesRequest {
    model: string;
    messages: AnthropicWireMessageParam[];
    max_tokens: number;
    system?: string | AnthropicWireTextBlock[];
    metadata?: AnthropicWireRequestMetadata;
    stop_sequences?: string[];
    stream?: boolean;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    tools?: AnthropicWireToolDefinition[];
    tool_choice?: AnthropicWireToolChoice;
    thinking?: AnthropicWireThinkingConfig;
    output_config?: AnthropicWireOutputConfig;
}

export interface AnthropicWireStopDetails {
    type: AnthropicStopReason.REFUSAL;
    category?: AnthropicRefusalCategory | null;
    explanation?: string;
}

export interface AnthropicWireUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
}

export interface AnthropicWireMessagesResponse {
    id: string;
    type: AnthropicMessageType;
    role: AnthropicMessageRole.ASSISTANT;
    content: AnthropicWireContentBlock[];
    model: string;
    stop_reason: AnthropicStopReason | null;
    stop_sequence: string | null;
    stop_details?: AnthropicWireStopDetails | null;
    usage: AnthropicWireUsage;
}

/** Body of every non-2xx Anthropic response. */
export interface AnthropicWireErrorResponse {
    type: AnthropicMessageType.ERROR;
    error: {
        type: string;
        message: string;
    };
}
