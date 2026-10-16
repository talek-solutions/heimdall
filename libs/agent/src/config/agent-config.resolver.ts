import type { ConfigService } from '@nestjs/config';
import { AgentEnvVariable } from '../enums';
import { AgentError, AgentErrorCode } from '../errors';
import type { IAgentConfig } from './agent-config.model';

export const DEFAULT_MAX_TURNS = 16;
export const DEFAULT_MAX_TOOL_CALLS = 48;
export const DEFAULT_MAX_INPUT_TOKENS = 600_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;
export const DEFAULT_MAX_TOOL_COST = 120;
export const DEFAULT_TIMEOUT_SECONDS = 300;
export const DEFAULT_TOOL_CONCURRENCY = 4;

/** An empty variable counts as unset. */
export function resolveAgentConfig(config: ConfigService): IAgentConfig {
  const count = (variable: AgentEnvVariable, fallback: number): number =>
    resolveCount(config, variable, fallback);

  return {
    budget: {
      maxTurns: count(AgentEnvVariable.MaxTurns, DEFAULT_MAX_TURNS),
      maxToolCalls: count(AgentEnvVariable.MaxToolCalls, DEFAULT_MAX_TOOL_CALLS),
      maxInputTokens: count(AgentEnvVariable.MaxInputTokens, DEFAULT_MAX_INPUT_TOKENS),
      maxOutputTokens: count(AgentEnvVariable.MaxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
      maxToolCost: count(AgentEnvVariable.MaxToolCost, DEFAULT_MAX_TOOL_COST),
      timeoutMs: count(AgentEnvVariable.TimeoutSeconds, DEFAULT_TIMEOUT_SECONDS) * 1_000,
    },
    toolConcurrency: count(AgentEnvVariable.ToolConcurrency, DEFAULT_TOOL_CONCURRENCY),
  };
}

function resolveCount(config: ConfigService, variable: AgentEnvVariable, fallback: number): number {
  const value = config.get<string>(variable) || String(fallback);
  const count = Number(value);

  if (!Number.isInteger(count) || count < 1) {
    throw new AgentError(
      AgentErrorCode.InvalidConfig,
      `${variable}='${value}' must be a whole number of at least 1`,
    );
  }
  return count;
}
