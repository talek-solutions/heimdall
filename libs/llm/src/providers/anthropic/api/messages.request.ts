/**
 * Anthropic Messages API request body (POST /v1/messages).
 */

import { AnthropicModel } from '../anthropic.enums';
import {
    AnthropicEffort,
    AnthropicMessageRole,
    AnthropicOutputFormatType,
    AnthropicTaskBudgetType,
    AnthropicThinkingDisplay,
    AnthropicThinkingType,
    AnthropicToolChoiceType,
} from './messages.enums';
import { AnthropicContentBlock, AnthropicTextBlock } from './messages.shared';

export interface AnthropicMessageParam {
    role: AnthropicMessageRole;
    content: string | AnthropicContentBlock[];
}

export type AnthropicSystemPrompt = string | AnthropicTextBlock[];

/** JSON Schema; the index signature keeps arbitrary keywords expressible. */
export interface AnthropicToolInputSchema {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    /** Must be `false` when `strict` is set on the tool. */
    additionalProperties?: boolean;
    [keyword: string]: unknown;
}

export interface AnthropicToolDefinition {
    name: string;
    description?: string;
    inputSchema: AnthropicToolInputSchema;
    /** Guarantees tool_use.input validates exactly against the schema. */
    strict?: boolean;
}

export interface AnthropicAutoToolChoice {
    type: AnthropicToolChoiceType.AUTO;
    disableParallelToolUse?: boolean;
}

export interface AnthropicAnyToolChoice {
    type: AnthropicToolChoiceType.ANY;
    disableParallelToolUse?: boolean;
}

export interface AnthropicSpecificToolChoice {
    type: AnthropicToolChoiceType.TOOL;
    name: string;
    disableParallelToolUse?: boolean;
}

export interface AnthropicNoneToolChoice {
    type: AnthropicToolChoiceType.NONE;
}

export type AnthropicToolChoice =
    | AnthropicAutoToolChoice
    | AnthropicAnyToolChoice
    | AnthropicSpecificToolChoice
    | AnthropicNoneToolChoice;

export interface AnthropicAdaptiveThinkingConfig {
    type: AnthropicThinkingType.ADAPTIVE;
    display?: AnthropicThinkingDisplay;
}

/** Legacy models only (<= Opus 4.6). Rejected with 400 on Opus 4.7/4.8 and Fable 5. */
export interface AnthropicEnabledThinkingConfig {
    type: AnthropicThinkingType.ENABLED;
    /** Must be strictly less than `maxTokens`. */
    budgetTokens: number;
}

export interface AnthropicDisabledThinkingConfig {
    type: AnthropicThinkingType.DISABLED;
}

export type AnthropicThinkingConfig =
    | AnthropicAdaptiveThinkingConfig
    | AnthropicEnabledThinkingConfig
    | AnthropicDisabledThinkingConfig;

export interface AnthropicTaskBudget {
    type: AnthropicTaskBudgetType;
    total: number;
    remaining?: number;
}

export interface AnthropicOutputFormat {
    type: AnthropicOutputFormatType;
    schema?: Record<string, unknown>;
}

export interface AnthropicOutputConfig {
    effort?: AnthropicEffort;
    taskBudget?: AnthropicTaskBudget;
    format?: AnthropicOutputFormat;
}

export interface AnthropicRequestMetadata {
    userId?: string;
}

export interface AnthropicMessagesRequest {
    model: AnthropicModel;
    messages: AnthropicMessageParam[];
    maxTokens: number;
    system?: AnthropicSystemPrompt;
    metadata?: AnthropicRequestMetadata;
    stopSequences?: string[];
    stream?: boolean;
    /** Sampling params: rejected with 400 on Opus 4.7/4.8 and Fable 5; valid on older models. */
    temperature?: number;
    topK?: number;
    topP?: number;
    tools?: AnthropicToolDefinition[];
    toolChoice?: AnthropicToolChoice;
    thinking?: AnthropicThinkingConfig;
    outputConfig?: AnthropicOutputConfig;
}
