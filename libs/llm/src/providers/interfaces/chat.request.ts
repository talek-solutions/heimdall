/**
 * Provider-neutral chat request.
 *
 * Holds only what every supported provider can express. Provider-specific
 * knobs (e.g. Anthropic thinking display, cache control, task budgets) go in
 * `providerOptions`, which each provider types with its own shape.
 */

import {
    LLMMessageRole,
    LLMReasoningEffort,
    LLMResponseFormatType,
    LLMToolChoiceType,
} from './chat.enums';
import { ILLMInputContentPart } from './chat.shared';

export interface ILLMMessage {
    role: LLMMessageRole;
    content: string | ILLMInputContentPart[];
}

export interface ILLMToolDefinition {
    name: string;
    description?: string;
    /** JSON Schema describing the tool arguments. */
    inputSchema: Record<string, unknown>;
    /** Ask the provider to guarantee arguments validate exactly against the schema. */
    strict?: boolean;
}

export interface ILLMAutoToolChoice {
    type: LLMToolChoiceType.AUTO;
}

export interface ILLMNoneToolChoice {
    type: LLMToolChoiceType.NONE;
}

export interface ILLMRequiredToolChoice {
    type: LLMToolChoiceType.REQUIRED;
}

export interface ILLMSpecificToolChoice {
    type: LLMToolChoiceType.TOOL;
    name: string;
}

export type ILLMToolChoice =
    | ILLMAutoToolChoice
    | ILLMNoneToolChoice
    | ILLMRequiredToolChoice
    | ILLMSpecificToolChoice;

export interface ILLMTextResponseFormat {
    type: LLMResponseFormatType.TEXT;
}

export interface ILLMJsonSchemaResponseFormat {
    type: LLMResponseFormatType.JSON_SCHEMA;
    /** JSON Schema the response must conform to. */
    schema: Record<string, unknown>;
    /** Optional name for the schema; some providers require one. */
    name?: string;
}

export type ILLMResponseFormat =
    | ILLMTextResponseFormat
    | ILLMJsonSchemaResponseFormat;

export interface ILLMReasoningConfig {
    effort?: LLMReasoningEffort;
}

export interface ILLMProviderMessageRequest<
    TProviderOptions = Record<string, unknown>,
> {
    /** Provider-specific model identifier; the provider validates it. */
    model: string;
    messages: ILLMMessage[];
    system?: string;
    /** Optional here; providers that require it apply their own default. */
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
    tools?: ILLMToolDefinition[];
    toolChoice?: ILLMToolChoice;
    responseFormat?: ILLMResponseFormat;
    reasoning?: ILLMReasoningConfig;
    /** Opaque caller metadata forwarded to the provider where supported (e.g. end-user id). */
    metadata?: Record<string, string>;
    /** Escape hatch for provider-specific parameters; typed by each provider. */
    providerOptions?: TProviderOptions;
}
