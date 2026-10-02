import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { InvestigationEnvVariable } from '../enums';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import {
  DEFAULT_MAX_CHECKS,
  DEFAULT_TRIAGE_MODEL,
  resolveInvestigationConfig,
} from './investigation-config.resolver';

function resolve(env: Record<string, string>): ReturnType<typeof resolveInvestigationConfig> {
  return resolveInvestigationConfig(new ConfigService(env));
}

describe('resolveInvestigationConfig', () => {
  it('defaults every setting, treating empty variables as unset', () => {
    const config = resolve({ [InvestigationEnvVariable.TriageModel]: '' });

    assert.equal(config.triage.model, DEFAULT_TRIAGE_MODEL);
    assert.equal(config.lookbackMs, 60 * 60_000);
    assert.equal(config.hopBudget, 1);
    assert.equal(config.maxChecks, DEFAULT_MAX_CHECKS);
  });

  it('reads overrides', () => {
    const config = resolve({
      [InvestigationEnvVariable.TriageModel]: 'claude-sonnet-5',
      [InvestigationEnvVariable.Lookback]: '2h',
      [InvestigationEnvVariable.HopBudget]: '0',
      [InvestigationEnvVariable.MaxChecks]: '10',
    });

    assert.equal(config.triage.model, 'claude-sonnet-5');
    assert.equal(config.lookbackMs, 2 * 3_600_000);
    assert.equal(config.hopBudget, 0);
    assert.equal(config.maxChecks, 10);
  });

  it('rejects values it cannot use, naming the variable', () => {
    for (const [variable, value] of [
      [InvestigationEnvVariable.Lookback, 'an hour'],
      [InvestigationEnvVariable.HopBudget, '-1'],
      [InvestigationEnvVariable.MaxChecks, '0'],
    ] as const) {
      assert.throws(
        () => resolve({ [variable]: value }),
        (error) =>
          error instanceof InvestigationError &&
          error.errorCode === InvestigationErrorCode.InvalidConfig &&
          error.message.includes(variable),
        variable,
      );
    }
  });
});
