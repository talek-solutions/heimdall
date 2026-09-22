import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_CONFIG } from '../llm.tokens';
import type { ILlmConfig } from './llm-config.model';
import { resolveLlmConfig } from './llm-config.resolver';

/** Config enters the lib here only; everything else receives `ILlmConfig` (ADR 0001). */
export const llmConfigProvider: Provider<ILlmConfig> = {
    provide: LLM_CONFIG,
    inject: [ConfigService],
    useFactory: (config: ConfigService): ILlmConfig => resolveLlmConfig(config),
};
