import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { llmConfigProvider } from './config/llm-config.provider';
import { LLM_CONFIG, LLM_PROVIDER } from './llm.tokens';
import { llmProvider } from './providers/llm-provider.provider';

@Module({
    imports: [ConfigModule],
    providers: [llmConfigProvider, llmProvider],
    exports: [LLM_CONFIG, LLM_PROVIDER],
})
export class LlmModule {}
