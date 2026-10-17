import type { ConfigService } from '@nestjs/config';
import { InvestigationEnvVariable } from '../enums';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import { parseDuration } from '../intake/duration';
import type { IExecutionConfig, IInvestigationConfig } from './investigation-config.model';

/** ADR 0004's model; the classification call needs judgement more than speed. */
export const DEFAULT_TRIAGE_MODEL = 'claude-opus-5';
export const DEFAULT_LOOKBACK = '60m';
export const DEFAULT_HOP_BUDGET = 1;
export const DEFAULT_MAX_CHECKS = 40;
/** The current default Opus (ADR 0004, amendment); the agent needs judgement across many turns. */
export const DEFAULT_AGENT_MODEL = 'claude-opus-5-5';
export const DEFAULT_DEVIATION_Z = 3.5;
export const DEFAULT_DEVIATION_MIN_RUN = 2;
export const DEFAULT_DEVIATION_MIN_EFFECT_PERCENT = 10;
export const DEFAULT_STEP_FLOOR_SECONDS = 1;
export const DEFAULT_LOG_SAMPLE_LIMIT = 250;
export const DEFAULT_TRACE_SAMPLE_LIMIT = 10;

const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_AMBIGUITY_MARGIN = 0.15;
const DEFAULT_MAX_CANDIDATES = 3;

/** An empty variable counts as unset. */
export function resolveInvestigationConfig(config: ConfigService): IInvestigationConfig {
  return {
    lookbackMs: resolveLookback(
      config.get<string>(InvestigationEnvVariable.Lookback) || DEFAULT_LOOKBACK,
    ),
    hopBudget: resolveCount(config, InvestigationEnvVariable.HopBudget, DEFAULT_HOP_BUDGET, 0),
    maxChecks: resolveCount(config, InvestigationEnvVariable.MaxChecks, DEFAULT_MAX_CHECKS, 1),
    triage: {
      model: config.get<string>(InvestigationEnvVariable.TriageModel) || DEFAULT_TRIAGE_MODEL,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
      ambiguityMargin: DEFAULT_AMBIGUITY_MARGIN,
      maxCandidates: DEFAULT_MAX_CANDIDATES,
    },
    execution: resolveExecution(config),
  };
}

function resolveExecution(config: ConfigService): IExecutionConfig {
  const turns = optionalCount(config, InvestigationEnvVariable.MaxTurns);
  const queries = optionalCount(config, InvestigationEnvVariable.MaxQueries);
  const timeout = optionalCount(config, InvestigationEnvVariable.TimeoutSeconds);

  return {
    model: config.get<string>(InvestigationEnvVariable.AgentModel) || DEFAULT_AGENT_MODEL,
    budget: {
      ...(turns === undefined ? {} : { maxTurns: turns }),
      ...(queries === undefined ? {} : { maxToolCost: queries }),
      ...(timeout === undefined ? {} : { timeoutMs: timeout * 1_000 }),
    },
    stepFloorSeconds: resolveCount(
      config,
      InvestigationEnvVariable.StepFloorSeconds,
      DEFAULT_STEP_FLOOR_SECONDS,
      1,
    ),
    deviation: {
      z: resolvePositive(config, InvestigationEnvVariable.DeviationZ, DEFAULT_DEVIATION_Z),
      minRun: resolveCount(
        config,
        InvestigationEnvVariable.DeviationMinRun,
        DEFAULT_DEVIATION_MIN_RUN,
        1,
      ),
      minEffect:
        resolveCount(
          config,
          InvestigationEnvVariable.DeviationMinEffectPercent,
          DEFAULT_DEVIATION_MIN_EFFECT_PERCENT,
          0,
        ) / 100,
    },
    evidence: {
      logSampleLimit: resolveCount(
        config,
        InvestigationEnvVariable.LogSampleLimit,
        DEFAULT_LOG_SAMPLE_LIMIT,
        1,
      ),
      traceSampleLimit: resolveCount(
        config,
        InvestigationEnvVariable.TraceSampleLimit,
        DEFAULT_TRACE_SAMPLE_LIMIT,
        1,
      ),
    },
  };
}

function optionalCount(
  config: ConfigService,
  variable: InvestigationEnvVariable,
): number | undefined {
  return config.get<string>(variable) ? resolveCount(config, variable, 0, 1) : undefined;
}

function resolvePositive(
  config: ConfigService,
  variable: InvestigationEnvVariable,
  fallback: number,
): number {
  const value = config.get<string>(variable) || String(fallback);
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    throw new InvestigationError(
      InvestigationErrorCode.InvalidConfig,
      `${variable}='${value}' must be a positive number`,
    );
  }
  return number;
}

function resolveLookback(value: string): number {
  const lookbackMs = parseDuration(value);

  if (lookbackMs === undefined) {
    throw new InvestigationError(
      InvestigationErrorCode.InvalidConfig,
      `${InvestigationEnvVariable.Lookback}='${value}' is not a duration such as 60m`,
    );
  }
  return lookbackMs;
}

function resolveCount(
  config: ConfigService,
  variable: InvestigationEnvVariable,
  fallback: number,
  minimum: number,
): number {
  const value = config.get<string>(variable) || String(fallback);
  const count = Number(value);

  if (!Number.isInteger(count) || count < minimum) {
    throw new InvestigationError(
      InvestigationErrorCode.InvalidConfig,
      `${variable}='${value}' must be a whole number of at least ${minimum}`,
    );
  }
  return count;
}
