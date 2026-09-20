/**
 * Provider-neutral shapes shared by BOTH the chat request and response.
 *
 * Content parts are the primary shared surface: they appear as message content
 * on the request (including prior assistant turns) and as the model output on
 * the response.
 */

import { LLMContentPartType, LLMImageSourceType } from './chat.enums';

export interface ILLMTextPart {
    type: LLMContentPartType.TEXT;
    text: string;
}

export interface ILLMBase64ImageSource {
    type: LLMImageSourceType.BASE64;
    /** e.g. 'image/png'. */
    mediaType: string;
    data: string;
}

export interface ILLMUrlImageSource {
    type: LLMImageSourceType.URL;
    url: string;
}

export type ILLMImageSource = ILLMBase64ImageSource | ILLMUrlImageSource;

export interface ILLMImagePart {
    type: LLMContentPartType.IMAGE;
    source: ILLMImageSource;
}

/** A tool invocation requested by the model. */
export interface ILLMToolCallPart {
    type: LLMContentPartType.TOOL_CALL;
    /** Provider-issued id; echoed back on the matching `ILLMToolResultPart`. */
    id: string;
    name: string;
    /** Parsed tool arguments. */
    input: Record<string, unknown>;
}

/** Content permitted inside a tool result (text or image only). */
export type ILLMToolResultContent = ILLMTextPart | ILLMImagePart;

/** The outcome of executing an `ILLMToolCallPart`, sent back to the model. */
export interface ILLMToolResultPart {
    type: LLMContentPartType.TOOL_RESULT;
    toolCallId: string;
    content: string | ILLMToolResultContent[];
    isError?: boolean;
}

/** Model reasoning as exposed by the provider. May be empty or summarized. */
export interface ILLMReasoningPart {
    type: LLMContentPartType.REASONING;
    text: string;
}

/** Parts a caller may place in request messages. */
export type ILLMInputContentPart =
    | ILLMTextPart
    | ILLMImagePart
    | ILLMToolCallPart
    | ILLMToolResultPart;

/** Parts a provider may return in the response. */
export type ILLMOutputContentPart =
    | ILLMTextPart
    | ILLMToolCallPart
    | ILLMReasoningPart;

export type ILLMContentPart = ILLMInputContentPart | ILLMOutputContentPart;

export interface ILLMUsage {
    inputTokens: number;
    outputTokens: number;
    /** Input tokens served from a provider-side prompt cache, if reported. */
    cachedInputTokens?: number;
    /** Tokens spent on reasoning, if the provider reports them separately. */
    reasoningTokens?: number;
}
