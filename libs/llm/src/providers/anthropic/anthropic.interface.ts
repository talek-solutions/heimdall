import {AnthropicMessageRole} from "./anthropic.enums";

/**
 * Anthropic Message API Request
 */
export interface AnthropicMessageApiRequest {
    maxTokens: number;
    messages: AnthropicMessageItem[];
    model: string;
    stream: boolean;
    system: AnthropicSystemItem;
    temperature: number;
    thinking: {
        type: 'adaptive'
    };
    tools: AnthropicToolCallRequest[];
    topK: number;
    topP: number;
}

export interface AnthropicMessageItem {
    content: string;
    role: AnthropicMessageRole;
}

export interface AnthropicSystemItem {
    text: string;
    type: 'text'
}

export interface AnthropicToolCallRequest {
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
    };
    name: string;
}

/**
 * Anthropic Message API Response
 */

