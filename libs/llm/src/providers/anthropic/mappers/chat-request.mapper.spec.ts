import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmError, LlmErrorCode } from '../../../errors';
import {
    LLMContentPartType,
    LLMImageSourceType,
    LLMMessageRole,
    LLMReasoningEffort,
    LLMResponseFormatType,
    LLMToolChoiceType,
} from '../../interfaces/chat.enums';
import { AnthropicModel } from '../anthropic.enums';
import {
    AnthropicCacheControlType,
    AnthropicContentBlockType,
    AnthropicEffort,
    AnthropicMessageRole,
    AnthropicOutputFormatType,
    AnthropicTaskBudgetType,
    AnthropicThinkingDisplay,
    AnthropicThinkingType,
    AnthropicToolChoiceType,
} from '../api/messages.enums';
import { toAnthropicRequest, type AnthropicChatRequest } from './chat-request.mapper';

const minimal: AnthropicChatRequest = {
    model: AnthropicModel.OPUS_5,
    messages: [{ role: LLMMessageRole.USER, content: 'hi' }],
};

function assertUnsupported(fn: () => unknown, messageIncludes: string): void {
    assert.throws(
        fn,
        (error: unknown) =>
            error instanceof LlmError &&
            error.errorCode === LlmErrorCode.UNSUPPORTED_REQUEST &&
            error.message.includes(messageIncludes),
    );
}

describe('toAnthropicRequest', () => {
    it('applies the default max tokens and emits nothing else optional', () => {
        assert.deepEqual(toAnthropicRequest(minimal), {
            model: AnthropicModel.OPUS_5,
            maxTokens: 16000,
            messages: [{ role: AnthropicMessageRole.USER, content: 'hi' }],
        });
    });

    it('rejects a model outside the AnthropicModel enum', () => {
        assertUnsupported(() => toAnthropicRequest({ ...minimal, model: 'gpt-5' }), "'gpt-5'");
    });

    it('maps user and assistant parts to content blocks', () => {
        const result = toAnthropicRequest({
            ...minimal,
            messages: [
                {
                    role: LLMMessageRole.USER,
                    content: [
                        { type: LLMContentPartType.TEXT, text: 'look' },
                        { type: LLMContentPartType.IMAGE, source: { type: LLMImageSourceType.URL, url: 'https://x/y.png' } },
                        {
                            type: LLMContentPartType.IMAGE,
                            source: { type: LLMImageSourceType.BASE64, mediaType: 'image/png', data: 'AA' },
                        },
                    ],
                },
                {
                    role: LLMMessageRole.ASSISTANT,
                    content: [{ type: LLMContentPartType.TOOL_CALL, id: 'c1', name: 'lookup', input: { q: 1 } }],
                },
            ],
        });

        assert.deepEqual(result.messages, [
            {
                role: AnthropicMessageRole.USER,
                content: [
                    { type: AnthropicContentBlockType.TEXT, text: 'look' },
                    { type: AnthropicContentBlockType.IMAGE, source: { type: 'url', url: 'https://x/y.png' } },
                    { type: AnthropicContentBlockType.IMAGE, source: { type: 'base64', mediaType: 'image/png', data: 'AA' } },
                ],
            },
            {
                role: AnthropicMessageRole.ASSISTANT,
                content: [{ type: AnthropicContentBlockType.TOOL_USE, id: 'c1', name: 'lookup', input: { q: 1 } }],
            },
        ]);
    });

    it('folds TOOL messages into a user message of tool_result blocks, merging consecutive ones', () => {
        const result = toAnthropicRequest({
            ...minimal,
            messages: [
                { role: LLMMessageRole.ASSISTANT, content: [
                    { type: LLMContentPartType.TOOL_CALL, id: 'c1', name: 'a', input: {} },
                    { type: LLMContentPartType.TOOL_CALL, id: 'c2', name: 'b', input: {} },
                ] },
                { role: LLMMessageRole.TOOL, content: [{ type: LLMContentPartType.TOOL_RESULT, toolCallId: 'c1', content: 'r1' }] },
                { role: LLMMessageRole.TOOL, content: [
                    { type: LLMContentPartType.TOOL_RESULT, toolCallId: 'c2', content: [{ type: LLMContentPartType.TEXT, text: 'r2' }], isError: true },
                ] },
                { role: LLMMessageRole.USER, content: 'thanks' },
            ],
        });

        assert.deepEqual(result.messages, [
            {
                role: AnthropicMessageRole.ASSISTANT,
                content: [
                    { type: AnthropicContentBlockType.TOOL_USE, id: 'c1', name: 'a', input: {} },
                    { type: AnthropicContentBlockType.TOOL_USE, id: 'c2', name: 'b', input: {} },
                ],
            },
            {
                role: AnthropicMessageRole.USER,
                content: [
                    { type: AnthropicContentBlockType.TOOL_RESULT, toolUseId: 'c1', content: 'r1' },
                    {
                        type: AnthropicContentBlockType.TOOL_RESULT,
                        toolUseId: 'c2',
                        content: [{ type: AnthropicContentBlockType.TEXT, text: 'r2' }],
                        isError: true,
                    },
                ],
            },
            { role: AnthropicMessageRole.USER, content: 'thanks' },
        ]);
    });

    it('rejects misplaced tool parts', () => {
        assertUnsupported(
            () => toAnthropicRequest({ ...minimal, messages: [{ role: LLMMessageRole.TOOL, content: 'plain' }] }),
            'plain string',
        );
        assertUnsupported(
            () => toAnthropicRequest({ ...minimal, messages: [
                { role: LLMMessageRole.TOOL, content: [{ type: LLMContentPartType.TEXT, text: 'x' }] },
            ] }),
            'TOOL_RESULT',
        );
        assertUnsupported(
            () => toAnthropicRequest({ ...minimal, messages: [
                { role: LLMMessageRole.USER, content: [{ type: LLMContentPartType.TOOL_CALL, id: 'c', name: 'n', input: {} }] },
            ] }),
            'ASSISTANT',
        );
        assertUnsupported(
            () => toAnthropicRequest({ ...minimal, messages: [
                { role: LLMMessageRole.USER, content: [{ type: LLMContentPartType.TOOL_RESULT, toolCallId: 'c', content: 'r' }] },
            ] }),
            'TOOL message',
        );
    });

    it('maps tools and every tool-choice kind (REQUIRED becomes any)', () => {
        const base = { ...minimal, tools: [{ name: 't', description: 'd', inputSchema: { type: 'object', properties: {} }, strict: true }] };

        assert.deepEqual(toAnthropicRequest(base).tools, [
            { name: 't', description: 'd', inputSchema: { type: 'object', properties: {} }, strict: true },
        ]);
        assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: { type: LLMToolChoiceType.AUTO } }).toolChoice, { type: AnthropicToolChoiceType.AUTO });
        assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: { type: LLMToolChoiceType.NONE } }).toolChoice, { type: AnthropicToolChoiceType.NONE });
        assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: { type: LLMToolChoiceType.REQUIRED } }).toolChoice, { type: AnthropicToolChoiceType.ANY });
        assert.deepEqual(toAnthropicRequest({ ...base, toolChoice: { type: LLMToolChoiceType.TOOL, name: 't' } }).toolChoice, { type: AnthropicToolChoiceType.TOOL, name: 't' });
    });

    it('rejects a tool schema that is not an object schema', () => {
        assertUnsupported(
            () => toAnthropicRequest({ ...minimal, tools: [{ name: 't', inputSchema: { type: 'string' } }] }),
            "'object'",
        );
    });

    it('maps reasoning effort and turns on adaptive thinking', () => {
        const result = toAnthropicRequest({ ...minimal, reasoning: { effort: LLMReasoningEffort.MEDIUM } });

        assert.deepEqual(result.thinking, { type: AnthropicThinkingType.ADAPTIVE });
        assert.deepEqual(result.outputConfig, { effort: AnthropicEffort.MEDIUM });
    });

    it('lets providerOptions override effort and thinking', () => {
        const result = toAnthropicRequest({
            ...minimal,
            reasoning: { effort: LLMReasoningEffort.LOW },
            providerOptions: {
                effort: AnthropicEffort.MAX,
                thinking: { type: AnthropicThinkingType.ADAPTIVE, display: AnthropicThinkingDisplay.SUMMARIZED },
                taskBudget: { type: AnthropicTaskBudgetType.TOKENS, total: 40000 },
                topK: 3,
            },
        });

        assert.deepEqual(result.thinking, { type: AnthropicThinkingType.ADAPTIVE, display: AnthropicThinkingDisplay.SUMMARIZED });
        assert.deepEqual(result.outputConfig, {
            effort: AnthropicEffort.MAX,
            taskBudget: { type: AnthropicTaskBudgetType.TOKENS, total: 40000 },
        });
        assert.equal(result.topK, 3);
    });

    it('maps a JSON-schema response format and ignores TEXT', () => {
        const schema = { type: 'object', properties: { verdict: { type: 'string' } } };

        assert.deepEqual(
            toAnthropicRequest({ ...minimal, responseFormat: { type: LLMResponseFormatType.JSON_SCHEMA, schema } }).outputConfig,
            { format: { type: AnthropicOutputFormatType.JSON_SCHEMA, schema } },
        );
        assert.equal(toAnthropicRequest({ ...minimal, responseFormat: { type: LLMResponseFormatType.TEXT } }).outputConfig, undefined);
    });

    it('turns the system prompt into a cached text block when asked', () => {
        const cacheControl = { type: AnthropicCacheControlType.EPHEMERAL };

        assert.equal(toAnthropicRequest({ ...minimal, system: 'sys' }).system, 'sys');
        assert.deepEqual(
            toAnthropicRequest({ ...minimal, system: 'sys', providerOptions: { systemCacheControl: cacheControl } }).system,
            [{ type: AnthropicContentBlockType.TEXT, text: 'sys', cacheControl }],
        );
    });

    it('passes sampling params, stop sequences and user metadata through', () => {
        const result = toAnthropicRequest({
            ...minimal,
            maxTokens: 512,
            temperature: 0.1,
            topP: 0.5,
            stopSequences: ['END'],
            metadata: { userId: 'u1', ignored: 'x' },
        });

        assert.equal(result.maxTokens, 512);
        assert.equal(result.temperature, 0.1);
        assert.equal(result.topP, 0.5);
        assert.deepEqual(result.stopSequences, ['END']);
        assert.deepEqual(result.metadata, { userId: 'u1' });
    });
});
