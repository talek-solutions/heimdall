import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { llmConfigProvider } from './config/llm-config.provider';
import { LLM_CONFIG, LLM_PROVIDER, LLM_TOOL_PORT } from './llm.tokens';
import { llmProvider } from './providers/llm-provider.provider';
import { llmToolPort } from './providers/llm-tool-port.provider';

@Module({
    imports: [ConfigModule],
    providers: [llmConfigProvider, llmProvider, llmToolPort],
    exports: [LLM_CONFIG, LLM_PROVIDER, LLM_TOOL_PORT],
})
export class LlmModule {}
