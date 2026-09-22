import { ConfigService } from '@nestjs/config';
import { LlmError, LlmErrorCode } from '../errors';
import { LlmProviderKind } from '../llm.enums';
import {
    DEFAULT_ANTHROPIC_API_URL,
    DEFAULT_ANTHROPIC_API_VERSION,
} from '../providers/anthropic/anthropic.constants';
import type { ILlmConfig } from './llm-config.model';

export enum LlmEnvVariable {
    PREFERRED_PROVIDER = 'PREFERRED_LLM_PROVIDER',
    ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY',
    ANTHROPIC_API_URL = 'ANTHROPIC_API_URL',
    ANTHROPIC_API_VERSION = 'ANTHROPIC_API_VERSION',
}

/**
 * An empty variable counts as unset (`||`, not `??`). Only the provider
 * selection can fail here; a missing API key is reported by the provider on
 * first use so that commands which never call the LLM still run.
 */
export function resolveLlmConfig(config: ConfigService): ILlmConfig {
    return {
        preferredProvider: resolvePreferredProvider(config),
        anthropic: {
            apiKey: config.get<string>(LlmEnvVariable.ANTHROPIC_API_KEY) || undefined,
            apiUrl: config.get<string>(LlmEnvVariable.ANTHROPIC_API_URL) || DEFAULT_ANTHROPIC_API_URL,
            apiVersion:
                config.get<string>(LlmEnvVariable.ANTHROPIC_API_VERSION) || DEFAULT_ANTHROPIC_API_VERSION,
        },
    };
}

function resolvePreferredProvider(config: ConfigService): LlmProviderKind {
    const value = config.get<string>(LlmEnvVariable.PREFERRED_PROVIDER) || LlmProviderKind.ANTHROPIC;
    const allowed = Object.values(LlmProviderKind);

    if (!allowed.includes(value as LlmProviderKind)) {
        throw new LlmError(
            LlmErrorCode.INVALID_PROVIDER,
            `${LlmEnvVariable.PREFERRED_PROVIDER}='${value}' is not valid; expected one of ${allowed.join(', ')}`,
        );
    }
    return value as LlmProviderKind;
}
