import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { AgentEnvVariable } from '../enums';
import { AgentError, AgentErrorCode } from '../errors';
import {
  DEFAULT_MAX_TURNS,
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_TOOL_CONCURRENCY,
  resolveAgentConfig,
} from './agent-config.resolver';

function resolve(env: Record<string, string>): ReturnType<typeof resolveAgentConfig> {
  return resolveAgentConfig(new ConfigService(env));
}

describe('resolveAgentConfig', () => {
  it('defaults every limit, treating empty variables as unset', () => {
    const config = resolve({ [AgentEnvVariable.MaxTurns]: '' });

    assert.equal(config.budget.maxTurns, DEFAULT_MAX_TURNS);
    assert.equal(config.budget.timeoutMs, DEFAULT_TIMEOUT_SECONDS * 1_000);
    assert.equal(config.toolConcurrency, DEFAULT_TOOL_CONCURRENCY);
  });

  it('reads overrides', () => {
    const config = resolve({
      [AgentEnvVariable.MaxTurns]: '3',
      [AgentEnvVariable.MaxToolCalls]: '9',
      [AgentEnvVariable.MaxInputTokens]: '50000',
      [AgentEnvVariable.MaxOutputTokens]: '4000',
      [AgentEnvVariable.MaxToolCost]: '12',
      [AgentEnvVariable.TimeoutSeconds]: '30',
      [AgentEnvVariable.ToolConcurrency]: '1',
    });

    assert.deepEqual(config, {
      budget: {
        maxTurns: 3,
        maxToolCalls: 9,
        maxInputTokens: 50_000,
        maxOutputTokens: 4_000,
        maxToolCost: 12,
        timeoutMs: 30_000,
      },
      toolConcurrency: 1,
    });
  });

  for (const value of ['0', '-2', '1.5', 'many']) {
    it(`rejects ${AgentEnvVariable.MaxTurns}='${value}'`, () => {
      assert.throws(
        () => resolve({ [AgentEnvVariable.MaxTurns]: value }),
        (error: unknown) =>
          error instanceof AgentError &&
          error.errorCode === AgentErrorCode.InvalidConfig &&
          error.message.includes(AgentEnvVariable.MaxTurns),
      );
    });
  }
});
