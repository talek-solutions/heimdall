import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { InvestigationEnvVariable } from '../enums';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import {
  DEFAULT_AGENT_MODEL,
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

  it('defaults execution, and overrides agent budgets only for the variables that are set', () => {
    const defaults = resolve({});
    const set = resolve({
      [InvestigationEnvVariable.AgentModel]: 'claude-opus-5',
      [InvestigationEnvVariable.MaxTurns]: '8',
      [InvestigationEnvVariable.MaxQueries]: '40',
      [InvestigationEnvVariable.TimeoutSeconds]: '90',
      [InvestigationEnvVariable.DeviationZ]: '3',
      [InvestigationEnvVariable.DeviationMinRun]: '3',
      [InvestigationEnvVariable.DeviationMinEffectPercent]: '25',
      [InvestigationEnvVariable.StepFloorSeconds]: '15',
    });

    assert.equal(defaults.execution.model, DEFAULT_AGENT_MODEL);
    assert.deepEqual(defaults.execution.budget, {});
    assert.deepEqual(defaults.execution.deviation, { z: 3.5, minRun: 2, minEffect: 0.1 });
    assert.deepEqual(set.execution, {
      model: 'claude-opus-5',
      budget: { maxTurns: 8, maxToolCost: 40, timeoutMs: 90_000 },
      stepFloorSeconds: 15,
      deviation: { z: 3, minRun: 3, minEffect: 0.25 },
    });
  });

  it('rejects an execution value it cannot use', () => {
    for (const [variable, value] of [
      [InvestigationEnvVariable.MaxTurns, '0'],
      [InvestigationEnvVariable.DeviationZ, '-1'],
      [InvestigationEnvVariable.StepFloorSeconds, 'fast'],
    ] as const) {
      assert.throws(
        () => resolve({ [variable]: value }),
        (error: unknown) =>
          error instanceof InvestigationError &&
          error.errorCode === InvestigationErrorCode.InvalidConfig &&
          error.message.includes(variable),
      );
    }
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
