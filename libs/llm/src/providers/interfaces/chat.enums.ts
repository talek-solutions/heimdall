/**
 * Provider-neutral enums for the abstract chat request/response shapes.
 *
 * Every provider maps its native values to/from these. Provider-specific
 * values that have no counterpart here belong in `providerOptions` / `raw`.
 */

export enum LLMMessageRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    /** Carries `TOOL_RESULT` parts answering a prior assistant `TOOL_CALL`. */
    TOOL = 'tool',
}

export enum LLMContentPartType {
    TEXT = 'text',
    IMAGE = 'image',
    TOOL_CALL = 'tool_call',
    TOOL_RESULT = 'tool_result',
    /** Model reasoning exposed by the provider (thinking / reasoning summaries). */
    REASONING = 'reasoning',
}

export enum LLMImageSourceType {
    BASE64 = 'base64',
    URL = 'url',
}

export enum LLMToolChoiceType {
    /** Model decides whether to call a tool. */
    AUTO = 'auto',
    /** Model must not call any tool. */
    NONE = 'none',
    /** Model must call at least one tool (any of them). */
    REQUIRED = 'required',
    /** Model must call the named tool. */
    TOOL = 'tool',
}

export enum LLMReasoningEffort {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
}

export enum LLMResponseFormatType {
    TEXT = 'text',
    JSON_SCHEMA = 'json_schema',
}

export enum LLMFinishReason {
    /** Natural end of the turn. */
    STOP = 'stop',
    /** Output token limit reached. */
    LENGTH = 'length',
    /** Model requested one or more tool calls. */
    TOOL_CALLS = 'tool_calls',
    /** Provider safety/content filter stopped generation. */
    CONTENT_FILTER = 'content_filter',
    /** Provider-specific reason with no normalized counterpart; inspect `raw`. */
    OTHER = 'other',
}
