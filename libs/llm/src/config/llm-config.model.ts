import { LlmProviderKind } from '../llm.enums';

export interface IAnthropicConfig {
    /**
     * Not optional on purpose: the resolver must answer explicitly, and the
     * provider decides when absence matters (on first use, so commands that
     * never call the LLM keep working).
     */
    readonly apiKey: string | undefined;
    readonly apiUrl: string;
    readonly apiVersion: string;
}

export interface ILlmConfig {
    readonly preferredProvider: LlmProviderKind;
    readonly anthropic: IAnthropicConfig;
}
