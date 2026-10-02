import type { ConfigService } from '@nestjs/config';
import { InvestigationEnvVariable } from '../enums';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import { parseDuration } from '../intake/duration';
import type { IInvestigationConfig } from './investigation-config.model';

/** ADR 0004's model; the classification call needs judgement more than speed. */
export const DEFAULT_TRIAGE_MODEL = 'claude-opus-5';
export const DEFAULT_LOOKBACK = '60m';
export const DEFAULT_HOP_BUDGET = 1;
export const DEFAULT_MAX_CHECKS = 40;

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
  };
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
