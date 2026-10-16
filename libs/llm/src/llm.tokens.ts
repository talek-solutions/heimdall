/** Resolves to `ILlmConfig`. */
export const LLM_CONFIG = Symbol('LLM_CONFIG');

/** Resolves to the `ILLMProvider` selected by `PREFERRED_LLM_PROVIDER`. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** Resolves to the `ILLMToolPort` of the provider selected by `PREFERRED_LLM_PROVIDER` (ADR 0017). */
export const LLM_TOOL_PORT = Symbol('LLM_TOOL_PORT');
