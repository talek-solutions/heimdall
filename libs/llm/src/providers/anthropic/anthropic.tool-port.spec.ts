import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlmError, LlmErrorCode } from '../../errors';
import type { ILLMToolSpec } from '../interfaces/tool-port.interface';
import { AnthropicToolPort } from './anthropic.tool-port';
import { AnthropicCacheControlType } from './api/messages.enums';
import { toAnthropicRequest } from './mappers/chat-request.mapper';
import { AnthropicModel } from './anthropic.enums';
import { LLMMessageRole } from '../interfaces/chat.enums';

const port = new AnthropicToolPort();

const runChecks: ILLMToolSpec = {
    name: 'run_checks',
    description: 'Runs planned checks',
    inputSchema: {
        type: 'object',
        properties: {
            ids: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 8 }, minItems: 1, maxItems: 20 },
            window: {
                type: 'object',
                properties: { minutes: { type: 'integer', minimum: 1, maximum: 1440 } },
            },
            mode: { anyOf: [{ type: 'string', enum: ['fast'] }, { type: 'object', properties: { depth: { type: 'number', multipleOf: 1 } } }] },
        },
        required: ['ids'],
    },
};

function assertUnsupported(fn: () => unknown, messageIncludes: string): void {
    assert.throws(
        fn,
        (error: unknown) =>
            error instanceof LlmError && error.errorCode === LlmErrorCode.UNSUPPORTED_REQUEST && error.message.includes(messageIncludes),
    );
}

describe('AnthropicToolPort', () => {
    it('renders strict tools: every object closed with a required list, unsupported keywords stripped at every depth', () => {
        assert.deepEqual(port.render([runChecks]), [
            {
                name: 'run_checks',
                description: 'Runs planned checks',
                strict: true,
                inputSchema: {
                    type: 'object',
                    properties: {
                        ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
                        window: {
                            type: 'object',
                            properties: { minutes: { type: 'integer' } },
                            additionalProperties: false,
                            required: [],
                        },
                        mode: {
                            anyOf: [
                                { type: 'string', enum: ['fast'] },
                                { type: 'object', properties: { depth: { type: 'number' } }, additionalProperties: false, required: [] },
                            ],
                        },
                    },
                    required: ['ids'],
                    additionalProperties: false,
                },
            },
        ]);
    });

    it('leaves the spec it was given untouched', () => {
        const before = JSON.stringify(runChecks);
        port.render([runChecks]);
        assert.equal(JSON.stringify(runChecks), before);
    });

    it('rejects a name outside the provider rule', () => {
        assertUnsupported(() => port.render([{ ...runChecks, name: 'run.checks' }]), "tool name 'run.checks'");
        assertUnsupported(() => port.render([{ ...runChecks, name: 'x'.repeat(65) }]), 'must match');
    });

    it('rejects an input schema that is not an object', () => {
        assertUnsupported(() => port.render([{ ...runChecks, inputSchema: { type: 'string' } }]), "of type 'object'");
    });

    it('declares parallel calls and strict schemas, but no forced tool choice', () => {
        assert.equal(port.capabilities.strictSchemas, true);
        assert.equal(port.capabilities.parallelToolCalls, true);
        assert.equal(port.capabilities.forcedToolChoice, false);
    });

    it('asks for a system-prompt breakpoint, which the request mapper turns into a cached prefix', () => {
        const options = port.requestOptions();
        const request = toAnthropicRequest({
            model: AnthropicModel.OPUS_5,
            system: 'You investigate.',
            messages: [{ role: LLMMessageRole.USER, content: 'go' }],
            tools: port.render([runChecks]),
            providerOptions: options,
        });

        assert.deepEqual(options, { systemCacheControl: { type: AnthropicCacheControlType.EPHEMERAL } });
        assert.deepEqual(request.system, [
            { type: 'text', text: 'You investigate.', cacheControl: { type: AnthropicCacheControlType.EPHEMERAL } },
        ]);
        assert.equal(request.tools?.[0]?.strict, true);
    });
});
