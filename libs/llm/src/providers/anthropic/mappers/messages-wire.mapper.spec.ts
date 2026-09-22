import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmError, LlmErrorCode } from '../../../errors';
import { AnthropicModel } from '../anthropic.enums';
import {
    AnthropicCacheControlType,
    AnthropicContentBlockType,
    AnthropicEffort,
    AnthropicImageSourceType,
    AnthropicMessageRole,
    AnthropicMessageType,
    AnthropicOutputFormatType,
    AnthropicRefusalCategory,
    AnthropicStopReason,
    AnthropicTaskBudgetType,
    AnthropicThinkingDisplay,
    AnthropicThinkingType,
    AnthropicToolChoiceType,
} from '../api/messages.enums';
import type { AnthropicMessagesRequest } from '../api/messages.request';
import type { AnthropicWireMessagesResponse } from '../api/messages.wire';
import { fromWireResponse, toWireRequest } from './messages-wire.mapper';

describe('toWireRequest', () => {
    it('renames every API field to snake_case and omits absent optionals', () => {
        const request: AnthropicMessagesRequest = {
            model: AnthropicModel.OPUS_5,
            maxTokens: 1024,
            system: [
                {
                    type: AnthropicContentBlockType.TEXT,
                    text: 'sys',
                    cacheControl: { type: AnthropicCacheControlType.EPHEMERAL, ttl: '1h' },
                },
            ],
            messages: [
                {
                    role: AnthropicMessageRole.USER,
                    content: [
                        { type: AnthropicContentBlockType.TEXT, text: 'hi' },
                        {
                            type: AnthropicContentBlockType.IMAGE,
                            source: {
                                type: AnthropicImageSourceType.BASE64,
                                mediaType: 'image/png',
                                data: 'AAAA',
                            },
                        },
                    ],
                },
                {
                    role: AnthropicMessageRole.ASSISTANT,
                    content: [
                        { type: AnthropicContentBlockType.THINKING, thinking: 't', signature: 'sig' },
                        { type: AnthropicContentBlockType.TOOL_USE, id: 'tu1', name: 'lookup', input: {} },
                    ],
                },
                {
                    role: AnthropicMessageRole.USER,
                    content: [
                        {
                            type: AnthropicContentBlockType.TOOL_RESULT,
                            toolUseId: 'tu1',
                            content: 'done',
                            isError: true,
                        },
                    ],
                },
            ],
            metadata: { userId: 'u1' },
            stopSequences: ['END'],
            temperature: 0.2,
            topK: 5,
            topP: 0.9,
            tools: [{ name: 'lookup', description: 'd', inputSchema: { type: 'object' }, strict: true }],
            toolChoice: { type: AnthropicToolChoiceType.TOOL, name: 'lookup', disableParallelToolUse: true },
            thinking: { type: AnthropicThinkingType.ADAPTIVE, display: AnthropicThinkingDisplay.SUMMARIZED },
            outputConfig: {
                effort: AnthropicEffort.XHIGH,
                taskBudget: { type: AnthropicTaskBudgetType.TOKENS, total: 30000 },
                format: { type: AnthropicOutputFormatType.JSON_SCHEMA, schema: { type: 'object' } },
            },
        };

        assert.deepEqual(toWireRequest(request), {
            model: 'claude-opus-5',
            max_tokens: 1024,
            system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral', ttl: '1h' } }],
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hi' },
                        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
                    ],
                },
                {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', thinking: 't', signature: 'sig' },
                        { type: 'tool_use', id: 'tu1', name: 'lookup', input: {} },
                    ],
                },
                {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'done', is_error: true }],
                },
            ],
            metadata: { user_id: 'u1' },
            stop_sequences: ['END'],
            temperature: 0.2,
            top_k: 5,
            top_p: 0.9,
            tools: [{ name: 'lookup', description: 'd', input_schema: { type: 'object' }, strict: true }],
            tool_choice: { type: 'tool', name: 'lookup', disable_parallel_tool_use: true },
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: {
                effort: 'xhigh',
                task_budget: { type: 'tokens', total: 30000 },
                format: { type: 'json_schema', schema: { type: 'object' } },
            },
        });
    });

    it('never emits keys with undefined values', () => {
        const wire = toWireRequest({
            model: AnthropicModel.OPUS_5,
            maxTokens: 1,
            messages: [{ role: AnthropicMessageRole.USER, content: 'x' }],
        });

        assert.deepEqual(Object.keys(wire).sort(), ['max_tokens', 'messages', 'model']);
    });

    it('passes caller-owned JSON (tool input, schemas) through byte for byte', () => {
        const input = { user_id: 1, nested: { someKey: 'v', another_key: [{ deep_key: true }] } };
        const inputSchema = {
            type: 'object' as const,
            properties: { user_id: { type: 'integer' }, camelCaseProp: { type: 'string' } },
            required: ['user_id'],
            additionalProperties: false,
        };
        const schema = { type: 'object', properties: { snake_case_field: { type: 'string' } } };

        const wire = toWireRequest({
            model: AnthropicModel.OPUS_5,
            maxTokens: 1,
            messages: [
                {
                    role: AnthropicMessageRole.ASSISTANT,
                    content: [{ type: AnthropicContentBlockType.TOOL_USE, id: 'a', name: 'n', input }],
                },
            ],
            tools: [{ name: 'n', inputSchema }],
            outputConfig: { format: { type: AnthropicOutputFormatType.JSON_SCHEMA, schema } },
        });

        const block = wire.messages[0]?.content[0];
        assert.ok(typeof block === 'object' && block.type === 'tool_use');
        assert.equal(JSON.stringify(block.input), JSON.stringify(input));
        assert.equal(JSON.stringify(wire.tools?.[0]?.input_schema), JSON.stringify(inputSchema));
        assert.equal(JSON.stringify(wire.output_config?.format?.schema), JSON.stringify(schema));
    });
});

describe('fromWireResponse', () => {
    const wire: AnthropicWireMessagesResponse = {
        id: 'msg_1',
        type: AnthropicMessageType.MESSAGE,
        role: AnthropicMessageRole.ASSISTANT,
        model: 'claude-opus-5',
        content: [
            { type: AnthropicContentBlockType.THINKING, thinking: '', signature: 's' },
            { type: AnthropicContentBlockType.TEXT, text: 'answer' },
            { type: AnthropicContentBlockType.TOOL_USE, id: 'tu', name: 'lookup', input: { snake_key: 1 } },
        ],
        stop_reason: AnthropicStopReason.REFUSAL,
        stop_sequence: null,
        stop_details: { type: AnthropicStopReason.REFUSAL, category: AnthropicRefusalCategory.CYBER, explanation: 'no' },
        usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 8, cache_creation_input_tokens: null },
    };

    it('renames every API field to camelCase', () => {
        assert.deepEqual(fromWireResponse(wire), {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content: [
                { type: 'thinking', thinking: '', signature: 's' },
                { type: 'text', text: 'answer' },
                { type: 'tool_use', id: 'tu', name: 'lookup', input: { snake_key: 1 } },
            ],
            stopReason: 'refusal',
            stopSequence: null,
            stopDetails: { type: 'refusal', category: 'cyber', explanation: 'no' },
            usage: { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 8 },
        });
    });

    it('normalizes absent stop_details to null', () => {
        const { stop_details: _ignored, ...withoutDetails } = wire;

        assert.equal(fromWireResponse(withoutDetails).stopDetails, null);
    });

    it('rejects a body missing the fields consumers depend on', () => {
        assert.throws(
            () => fromWireResponse({ id: 'x' } as unknown as AnthropicWireMessagesResponse),
            (error: unknown) => error instanceof LlmError && error.errorCode === LlmErrorCode.INVALID_RESPONSE,
        );
    });

    it('rejects an unknown content block type', () => {
        const bad = { ...wire, content: [{ type: 'hologram' }] } as unknown as AnthropicWireMessagesResponse;

        assert.throws(
            () => fromWireResponse(bad),
            (error: unknown) =>
                error instanceof LlmError &&
                error.errorCode === LlmErrorCode.INVALID_RESPONSE &&
                error.message.includes('hologram'),
        );
    });
});
