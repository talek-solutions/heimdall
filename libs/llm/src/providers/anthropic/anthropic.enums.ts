/**
 * General Anthropic enums not tied to a specific API type.
 * API-type-specific enums live under `interfaces/<interfaces-type>.enums.ts`.
 */

export enum AnthropicModel {
    FABLE_5 = 'claude-fable-5',
    OPUS_4_8 = 'claude-opus-4-8',
    OPUS_4_7 = 'claude-opus-4-7',
    OPUS_4_6 = 'claude-opus-4-6',
    SONNET_4_6 = 'claude-sonnet-4-6',
    HAIKU_4_5 = 'claude-haiku-4-5',
}

export enum AnthropicApiEndpoints {
    MESSAGES = '/v1/messages'
}