import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { LlmError, LlmErrorCode } from '../errors';
import { LlmProviderKind } from '../llm.enums';
import { LlmEnvVariable, resolveLlmConfig } from './llm-config.resolver';

describe('resolveLlmConfig', () => {
    // ConfigService reads process.env before its internal config, so the
    // developer's shell must not leak into these cases.
    const saved: Partial<Record<LlmEnvVariable, string | undefined>> = {};

    beforeEach(() => {
        for (const name of Object.values(LlmEnvVariable)) {
            saved[name] = process.env[name];
            delete process.env[name];
        }
    });

    afterEach(() => {
        for (const name of Object.values(LlmEnvVariable)) {
            const value = saved[name];
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    it('defaults to Anthropic with the public API URL and version', () => {
        const config = resolveLlmConfig(new ConfigService());

        assert.equal(config.preferredProvider, LlmProviderKind.ANTHROPIC);
        assert.equal(config.anthropic.apiKey, undefined);
        assert.equal(config.anthropic.apiUrl, 'https://api.anthropic.com');
        assert.equal(config.anthropic.apiVersion, '2023-06-01');
    });

    it('reads every Anthropic variable', () => {
        const config = resolveLlmConfig(
            new ConfigService({
                [LlmEnvVariable.PREFERRED_PROVIDER]: 'anthropic',
                [LlmEnvVariable.ANTHROPIC_API_KEY]: 'sk-test',
                [LlmEnvVariable.ANTHROPIC_API_URL]: 'https://proxy.internal/anthropic',
                [LlmEnvVariable.ANTHROPIC_API_VERSION]: '2024-01-01',
            }),
        );

        assert.deepEqual(config.anthropic, {
            apiKey: 'sk-test',
            apiUrl: 'https://proxy.internal/anthropic',
            apiVersion: '2024-01-01',
        });
    });

    it('treats the empty string as unset', () => {
        const config = resolveLlmConfig(
            new ConfigService({
                [LlmEnvVariable.PREFERRED_PROVIDER]: '',
                [LlmEnvVariable.ANTHROPIC_API_KEY]: '',
                [LlmEnvVariable.ANTHROPIC_API_URL]: '',
            }),
        );

        assert.equal(config.preferredProvider, LlmProviderKind.ANTHROPIC);
        assert.equal(config.anthropic.apiKey, undefined);
        assert.equal(config.anthropic.apiUrl, 'https://api.anthropic.com');
    });

    it('reads process.env, where ConfigModule.forRoot() puts the .env values', () => {
        process.env[LlmEnvVariable.ANTHROPIC_API_URL] = 'https://from-env.example';

        const config = resolveLlmConfig(new ConfigService());

        assert.equal(config.anthropic.apiUrl, 'https://from-env.example');
    });

    it('does not throw when the API key is missing', () => {
        assert.doesNotThrow(() =>
            resolveLlmConfig(new ConfigService({ [LlmEnvVariable.PREFERRED_PROVIDER]: 'anthropic' })),
        );
    });

    it('rejects an unknown provider with LLM_INVALID_PROVIDER', () => {
        assert.throws(
            () => resolveLlmConfig(new ConfigService({ [LlmEnvVariable.PREFERRED_PROVIDER]: 'openai' })),
            (error: unknown) =>
                error instanceof LlmError &&
                error.errorCode === LlmErrorCode.INVALID_PROVIDER &&
                error.message.includes('PREFERRED_LLM_PROVIDER') &&
                error.message.includes('anthropic'),
        );
    });
});
