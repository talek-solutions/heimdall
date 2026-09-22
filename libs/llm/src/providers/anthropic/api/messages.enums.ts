export enum AnthropicMessageRole {
    USER = 'user',
    ASSISTANT = 'assistant',
    SYSTEM = 'system',
}

export enum AnthropicMessageType {
    MESSAGE = 'message',
    ERROR = 'error',
}

export enum AnthropicContentBlockType {
    TEXT = 'text',
    THINKING = 'thinking',
    REDACTED_THINKING = 'redacted_thinking',
    TOOL_USE = 'tool_use',
    TOOL_RESULT = 'tool_result',
    IMAGE = 'image',
}

export enum AnthropicImageSourceType {
    BASE64 = 'base64',
    URL = 'url',
}

export enum AnthropicCacheControlType {
    EPHEMERAL = 'ephemeral',
}

export enum AnthropicStopReason {
    END_TURN = 'end_turn',
    MAX_TOKENS = 'max_tokens',
    STOP_SEQUENCE = 'stop_sequence',
    TOOL_USE = 'tool_use',
    PAUSE_TURN = 'pause_turn',
    REFUSAL = 'refusal',
}

export enum AnthropicRefusalCategory {
    CYBER = 'cyber',
    BIO = 'bio',
    REASONING_EXTRACTION = 'reasoning_extraction',
    FRONTIER_LLM = 'frontier_llm',
}

export enum AnthropicToolChoiceType {
    AUTO = 'auto',
    ANY = 'any',
    TOOL = 'tool',
    NONE = 'none',
}

export enum AnthropicThinkingType {
    ADAPTIVE = 'adaptive',
    /** Legacy (<= Opus 4.6). Rejected with 400 on Opus 4.7/4.8 and Fable 5. */
    ENABLED = 'enabled',
    DISABLED = 'disabled',
}

export enum AnthropicThinkingDisplay {
    SUMMARIZED = 'summarized',
    OMITTED = 'omitted',
}

export enum AnthropicEffort {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    XHIGH = 'xhigh',
    MAX = 'max',
}

export enum AnthropicTaskBudgetType {
    TOKENS = 'tokens',
}

export enum AnthropicOutputFormatType {
    JSON_SCHEMA = 'json_schema',
}
