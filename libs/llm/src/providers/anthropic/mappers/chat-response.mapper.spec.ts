import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LLMContentPartType, LLMFinishReason, LLMMessageRole } from '../../interfaces/chat.enums';
import { AnthropicContentBlockType, AnthropicMessageRole, AnthropicMessageType, AnthropicStopReason } from '../api/messages.enums';
import type { AnthropicMessagesResponse } from '../api/messages.response';
import { fromAnthropicResponse } from './chat-response.mapper';

const base: AnthropicMessagesResponse = {
    id: 'msg_1',
    type: AnthropicMessageType.MESSAGE,
    role: AnthropicMessageRole.ASSISTANT,
    model: 'claude-opus-5',
    content: [],
    stopReason: AnthropicStopReason.END_TURN,
    stopSequence: null,
    stopDetails: null,
    usage: { inputTokens: 10, outputTokens: 5 },
};

describe('fromAnthropicResponse', () => {
    it('maps output blocks, keeping what is needed to send reasoning back', () => {
        const result = fromAnthropicResponse({
            ...base,
            content: [
                { type: AnthropicContentBlockType.THINKING, thinking: 'because', signature: 's' },
                { type: AnthropicContentBlockType.REDACTED_THINKING, data: 'opaque' },
                { type: AnthropicContentBlockType.TEXT, text: 'answer' },
                { type: AnthropicContentBlockType.TOOL_USE, id: 'c1', name: 'lookup', input: { q: 1 } },
            ],
        });

        assert.equal(result.id, 'msg_1');
        assert.equal(result.model, 'claude-opus-5');
        assert.equal(result.role, LLMMessageRole.ASSISTANT);
        assert.deepEqual(result.content, [
            { type: LLMContentPartType.REASONING, text: 'because', signature: 's' },
            { type: LLMContentPartType.REASONING, text: '', redactedData: 'opaque' },
            { type: LLMContentPartType.TEXT, text: 'answer' },
            { type: LLMContentPartType.TOOL_CALL, id: 'c1', name: 'lookup', input: { q: 1 } },
        ]);
    });

    it('keeps only text from before the last fallback switch, and drops the switch markers', () => {
        const result = fromAnthropicResponse({
            ...base,
            model: 'claude-opus-5',
            content: [
                { type: AnthropicContentBlockType.THINKING, thinking: 'declined', signature: 'old' },
                { type: AnthropicContentBlockType.TOOL_USE, id: 'c0', name: 'lookup', input: {} },
                { type: AnthropicContentBlockType.TEXT, text: 'partial' },
                { type: AnthropicContentBlockType.FALLBACK, from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
                { type: AnthropicContentBlockType.THINKING, thinking: 'served', signature: 'new' },
                { type: AnthropicContentBlockType.TOOL_USE, id: 'c1', name: 'lookup', input: { q: 1 } },
            ],
        });

        assert.deepEqual(result.content, [
            { type: LLMContentPartType.TEXT, text: 'partial' },
            { type: LLMContentPartType.REASONING, text: 'served', signature: 'new' },
            { type: LLMContentPartType.TOOL_CALL, id: 'c1', name: 'lookup', input: { q: 1 } },
        ]);
    });

    it('normalizes every stop reason', () => {
        const cases: Array<[AnthropicStopReason | null, LLMFinishReason]> = [
            [AnthropicStopReason.END_TURN, LLMFinishReason.STOP],
            [AnthropicStopReason.STOP_SEQUENCE, LLMFinishReason.STOP],
            [AnthropicStopReason.MAX_TOKENS, LLMFinishReason.LENGTH],
            [AnthropicStopReason.TOOL_USE, LLMFinishReason.TOOL_CALLS],
            [AnthropicStopReason.REFUSAL, LLMFinishReason.CONTENT_FILTER],
            [AnthropicStopReason.PAUSE_TURN, LLMFinishReason.PAUSED],
            [null, LLMFinishReason.OTHER],
        ];

        for (const [stopReason, expected] of cases) {
            assert.equal(fromAnthropicResponse({ ...base, stopReason }).finishReason, expected, String(stopReason));
        }
    });

    it('maps usage, exposing cache reads as cachedInputTokens only when reported', () => {
        assert.deepEqual(fromAnthropicResponse(base).usage, { inputTokens: 10, outputTokens: 5 });
        assert.deepEqual(
            fromAnthropicResponse({ ...base, usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 8, cacheCreationInputTokens: 2 } }).usage,
            { inputTokens: 10, outputTokens: 5, cachedInputTokens: 8 },
        );
    });

    it('keeps the full Anthropic response as raw', () => {
        assert.equal(fromAnthropicResponse(base).raw, base);
    });
});
