import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ILlmConfig } from './config/llm-config.model';
import { InjectLlmProvider } from './inject-llm-provider.decorator';
import { InjectLlmToolPort } from './inject-llm-tool-port.decorator';
import { LlmProviderKind } from './llm.enums';
import { LlmModule } from './llm.module';
import { LLM_CONFIG, LLM_PROVIDER, LLM_TOOL_PORT } from './llm.tokens';
import { AnthropicProvider } from './providers/anthropic/anthropic.provider';
import { AnthropicToolPort } from './providers/anthropic/anthropic.tool-port';
import type { ILLMToolPort } from './providers/interfaces/tool-port.interface';
import type { ILLMProvider } from './providers/llm-provider.interface';

const keylessConfig: ILlmConfig = {
    preferredProvider: LlmProviderKind.ANTHROPIC,
    anthropic: { apiKey: undefined, apiUrl: 'https://api.example', apiVersion: '2023-06-01' },
};

@Injectable()
class Consumer {
    constructor(
        @InjectLlmProvider() public readonly llm: ILLMProvider,
        @InjectLlmToolPort() public readonly tools: ILLMToolPort,
    ) {}
}

describe('LlmModule', () => {
    it('resolves LLM_PROVIDER to the Anthropic adapter for the anthropic kind', async () => {
        const moduleRef = await Test.createTestingModule({ imports: [LlmModule] })
            .overrideProvider(LLM_CONFIG)
            .useValue(keylessConfig)
            .compile();

        assert.ok(moduleRef.get(LLM_PROVIDER) instanceof AnthropicProvider);
    });

    it('resolves LLM_TOOL_PORT to the port of the same provider', async () => {
        const moduleRef = await Test.createTestingModule({ imports: [LlmModule] })
            .overrideProvider(LLM_CONFIG)
            .useValue(keylessConfig)
            .compile();

        assert.ok(moduleRef.get(LLM_TOOL_PORT) instanceof AnthropicToolPort);
    });

    it('compiles without an API key, so commands that never call the LLM still start', async () => {
        await assert.doesNotReject(
            Test.createTestingModule({ imports: [LlmModule] })
                .overrideProvider(LLM_CONFIG)
                .useValue(keylessConfig)
                .compile(),
        );
    });

    it('reads its config from the environment when not overridden', async () => {
        const previous = process.env['ANTHROPIC_API_URL'];
        process.env['ANTHROPIC_API_URL'] = 'https://from-env.example';
        try {
            const moduleRef = await Test.createTestingModule({ imports: [LlmModule] }).compile();

            assert.equal(moduleRef.get<ILlmConfig>(LLM_CONFIG).anthropic.apiUrl, 'https://from-env.example');
        } finally {
            if (previous === undefined) {
                delete process.env['ANTHROPIC_API_URL'];
            } else {
                process.env['ANTHROPIC_API_URL'] = previous;
            }
        }
    });

    it('lets a consumer inject the provider through @InjectLlmProvider()', async () => {
        const moduleRef = await Test.createTestingModule({ imports: [LlmModule], providers: [Consumer] })
            .overrideProvider(LLM_CONFIG)
            .useValue(keylessConfig)
            .compile();

        assert.ok(moduleRef.get(Consumer).llm instanceof AnthropicProvider);
        assert.ok(moduleRef.get(Consumer).tools instanceof AnthropicToolPort);
    });
});
