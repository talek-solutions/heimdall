import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmError, LlmErrorCode } from '../../errors';
import { LLMContentPartType, LLMFinishReason, LLMMessageRole } from '../interfaces/chat.enums';
import { LlmApiClient } from '../llm-api.client';
import { AnthropicModel } from './anthropic.enums';
import { AnthropicProvider } from './anthropic.provider';
import { AnthropicMessageRole, AnthropicStopReason, AnthropicTaskBudgetType } from './api/messages.enums';

interface RecordedCall {
    url: string;
    headers: Record<string, string>;
    body: unknown;
}

function setup(apiKey: string | undefined, respond: () => Response = okResponse): { provider: AnthropicProvider; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
        calls.push({
            url: String(input),
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        return respond();
    };
    const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });
    const provider = new AnthropicProvider({ apiKey, apiUrl: 'https://api.example', apiVersion: '2023-06-01' }, client);
    return { provider, calls };
}

function okResponse(): Response {
    return new Response(
        JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5',
            content: [
                { type: 'text', text: 'Looking it up.' },
                { type: 'tool_use', id: 'c1', name: 'lookup', input: { service_name: 'api' } },
            ],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 10 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

describe('AnthropicProvider', () => {
    it('can be constructed without an API key', () => {
        assert.doesNotThrow(() => setup(undefined));
    });

    it('fails on first use with LLM_MISSING_API_KEY when no key is configured', async () => {
        const { provider, calls } = setup(undefined);

        await assert.rejects(
            provider.chat({ model: AnthropicModel.OPUS_5, messages: [{ role: LLMMessageRole.USER, content: 'hi' }] }),
            (error: unknown) => error instanceof LlmError && error.errorCode === LlmErrorCode.MISSING_API_KEY,
        );
        assert.equal(calls.length, 0);
    });

    it('chat() posts a snake_case body with auth headers and maps the reply', async () => {
        const { provider, calls } = setup('sk-test');

        const response = await provider.chat({
            model: AnthropicModel.OPUS_5,
            system: 'You investigate incidents.',
            maxTokens: 2048,
            messages: [{ role: LLMMessageRole.USER, content: 'Why is checkout slow?' }],
            tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: { service_name: { type: 'string' } } } }],
            providerOptions: { betas: ['task-budgets-2026-03-13'], taskBudget: { type: AnthropicTaskBudgetType.TOKENS, total: 30000 } },
        });

        assert.equal(calls[0]?.url, 'https://api.example/v1/messages');
        assert.deepEqual(calls[0]?.headers, {
            'x-api-key': 'sk-test',
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'task-budgets-2026-03-13',
            'content-type': 'application/json',
        });
        assert.deepEqual(calls[0]?.body, {
            model: 'claude-opus-5',
            max_tokens: 2048,
            system: 'You investigate incidents.',
            messages: [{ role: 'user', content: 'Why is checkout slow?' }],
            tools: [{ name: 'lookup', input_schema: { type: 'object', properties: { service_name: { type: 'string' } } } }],
            output_config: { task_budget: { type: 'tokens', total: 30000 } },
        });

        assert.equal(response.id, 'msg_1');
        assert.equal(response.finishReason, LLMFinishReason.TOOL_CALLS);
        assert.deepEqual(response.content, [
            { type: LLMContentPartType.TEXT, text: 'Looking it up.' },
            { type: LLMContentPartType.TOOL_CALL, id: 'c1', name: 'lookup', input: { service_name: 'api' } },
        ]);
        assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 7, cachedInputTokens: 10 });
        assert.equal(response.raw?.stopReason, AnthropicStopReason.TOOL_USE);
    });

    it('omits the beta header when no betas are requested', async () => {
        const { provider, calls } = setup('sk-test');

        await provider.messages({
            model: AnthropicModel.OPUS_5,
            maxTokens: 1,
            messages: [{ role: AnthropicMessageRole.USER, content: 'hi' }],
        });

        assert.equal(calls[0]?.headers['anthropic-beta'], undefined);
    });

    it('surfaces provider errors from the client as LlmError', async () => {
        const { provider } = setup('sk-bad', () =>
            new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 }),
        );

        await assert.rejects(
            provider.chat({ model: AnthropicModel.OPUS_5, messages: [{ role: LLMMessageRole.USER, content: 'hi' }] }),
            (error: unknown) => error instanceof LlmError && error.errorCode === LlmErrorCode.AUTHENTICATION_FAILED,
        );
    });
});
