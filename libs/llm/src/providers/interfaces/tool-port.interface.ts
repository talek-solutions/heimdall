import type { ILLMToolDefinition } from './chat.request';

/** A tool as an agent defines it, before any provider shapes it (ADR 0017). */
export interface ILLMToolSpec {
    name: string;
    description: string;
    /** JSON Schema of type 'object'. Constraints a provider cannot take are still the tool's to enforce. */
    inputSchema: Record<string, unknown>;
}

export interface ILLMToolCapabilities {
    /** Arguments are guaranteed to validate against the rendered schema. */
    strictSchemas: boolean;
    /** One reply may carry several tool calls. */
    parallelToolCalls: boolean;
    /** `tool_choice` may force a call; when false, only AUTO and NONE are safe. */
    forcedToolChoice: boolean;
    namePattern: RegExp;
}

/**
 * Shapes provider-neutral tool specs for one provider, so tools are written once and each
 * provider's rules live in one place (ADR 0017).
 */
export interface ILLMToolPort<TProviderOptions extends object = object> {
    readonly capabilities: ILLMToolCapabilities;
    /** Throws `LlmError(UNSUPPORTED_REQUEST)` for a spec the provider cannot take. */
    render(specs: readonly ILLMToolSpec[]): ILLMToolDefinition[];
    /** Provider options that belong with rendered tools, e.g. a cache breakpoint. */
    requestOptions(): TProviderOptions;
}
