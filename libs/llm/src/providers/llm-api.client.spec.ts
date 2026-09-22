import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmError, LlmErrorCode } from '../errors';
import { LlmApiClient } from './llm-api.client';

interface RecordedCall {
    url: string;
    init: RequestInit;
}

function fakeFetch(
    respond: (call: RecordedCall) => Response | Promise<Response>,
): { fetchFn: typeof fetch; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
        const call = { url: String(input), init: init ?? {} };
        calls.push(call);
        return respond(call);
    };
    return { fetchFn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function assertLlmError(error: unknown, code: LlmErrorCode, messageIncludes?: string): void {
    assert.ok(error instanceof LlmError, `expected LlmError, got ${String(error)}`);
    assert.equal(error.errorCode, code);
    if (messageIncludes !== undefined) {
        assert.ok(
            error.message.includes(messageIncludes),
            `expected "${error.message}" to include "${messageIncludes}"`,
        );
    }
}

describe('LlmApiClient', () => {
    it('joins the base URL and path, preserving a path prefix', async () => {
        const { fetchFn, calls } = fakeFetch(() => jsonResponse(200, {}));
        const client = new LlmApiClient({ apiUrl: 'https://proxy.internal/anthropic/', fetchFn });

        await client.post({ path: '/v1/messages' });

        assert.equal(calls[0]?.url, 'https://proxy.internal/anthropic/v1/messages');
    });

    it('sends a JSON body with a default content-type and the given headers', async () => {
        const { fetchFn, calls } = fakeFetch(() => jsonResponse(200, {}));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        await client.post({
            path: '/x',
            headers: { 'x-api-key': 'k' },
            body: { max_tokens: 1, nested: { keep_me: true } },
        });

        const init = calls[0]?.init;
        assert.equal(init?.method, 'POST');
        assert.deepEqual(init?.headers, { 'x-api-key': 'k', 'content-type': 'application/json' });
        assert.equal(init?.body, '{"max_tokens":1,"nested":{"keep_me":true}}');
    });

    it('does not override an explicit content-type header', async () => {
        const { fetchFn, calls } = fakeFetch(() => jsonResponse(200, {}));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        await client.post({ path: '/x', headers: { 'Content-Type': 'text/plain' } });

        assert.deepEqual(calls[0]?.init.headers, { 'Content-Type': 'text/plain' });
    });

    it('returns the parsed JSON body on success', async () => {
        const { fetchFn } = fakeFetch(() => jsonResponse(200, { id: 'msg_1' }));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        const result = await client.post<{ id: string }>({ path: '/x' });

        assert.deepEqual(result, { id: 'msg_1' });
    });

    it('maps 401 and 403 to LLM_AUTHENTICATION_FAILED with the provider message', async () => {
        for (const status of [401, 403]) {
            const { fetchFn } = fakeFetch(() =>
                jsonResponse(status, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
            );
            const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

            await assert.rejects(client.post({ path: '/x' }), (error: unknown) => {
                assertLlmError(error, LlmErrorCode.AUTHENTICATION_FAILED, 'invalid x-api-key');
                return true;
            });
        }
    });

    it('maps 429 to LLM_RATE_LIMITED', async () => {
        const { fetchFn } = fakeFetch(() => jsonResponse(429, { message: 'slow down' }));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        await assert.rejects(client.post({ path: '/x' }), (error: unknown) => {
            assertLlmError(error, LlmErrorCode.RATE_LIMITED, 'slow down');
            return true;
        });
    });

    it('maps other non-2xx statuses to LLM_REQUEST_FAILED, tolerating a non-JSON body', async () => {
        const { fetchFn } = fakeFetch(() => new Response('<html>boom</html>', { status: 502 }));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        await assert.rejects(client.post({ path: '/x' }), (error: unknown) => {
            assertLlmError(error, LlmErrorCode.REQUEST_FAILED, '502');
            return true;
        });
    });

    it('wraps a thrown fetch in LLM_NETWORK_ERROR and keeps the cause', async () => {
        const cause = new Error('ECONNREFUSED');
        const { fetchFn } = fakeFetch(() => {
            throw cause;
        });
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        await assert.rejects(client.post({ path: '/x' }), (error: unknown) => {
            assertLlmError(error, LlmErrorCode.NETWORK_ERROR);
            assert.equal((error as LlmError).cause, cause);
            return true;
        });
    });

    it('rejects a 2xx non-JSON body with LLM_INVALID_RESPONSE', async () => {
        const { fetchFn } = fakeFetch(() => new Response('not json', { status: 200 }));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });

        await assert.rejects(client.post({ path: '/x' }), (error: unknown) => {
            assertLlmError(error, LlmErrorCode.INVALID_RESPONSE);
            return true;
        });
    });

    it('forwards an abort signal', async () => {
        const { fetchFn, calls } = fakeFetch(() => jsonResponse(200, {}));
        const client = new LlmApiClient({ apiUrl: 'https://api.example', fetchFn });
        const controller = new AbortController();

        await client.post({ path: '/x', signal: controller.signal });

        assert.equal(calls[0]?.init.signal, controller.signal);
    });
});
