import 'reflect-metadata';

export {
  agreement,
  Calibrator,
  MAX_DEVIATION,
  MIN_AGREEMENT,
  MIN_SHEETS,
  type ICalibrationLock,
  type ICalibrationState,
  type IScoringSheet,
} from './calibration/calibrator';
export type * from './cases/golden-case.interface';
export { GoldenCaseLoader, parseCase } from './cases/golden-case.loader';
export type { IEvalsConfig } from './config/evals-config.model';
export { DEFAULT_JUDGE_MODEL, resolveEvalsConfig } from './config/evals-config.resolver';
export * from './errors';
export { EvalService, type IEvalOptions } from './eval.service';
export * from './evals.enums';
export { EvalsModule } from './evals.module';
export { EVALS_CONFIG } from './evals.tokens';
export { CaseRunner, spawnCli, type ICaseRun, type Spawn } from './run/case.runner';
export { checkRun, type ICheckResults } from './score/checks';
export {
  Judge,
  JUDGE_SYSTEM_PROMPT,
  judgeInput,
  type IDimensionScore,
  type IJudgement,
  type IJudgeInput,
  type IJudgeScores,
} from './score/judge';
export type * from './score/scorecard.interface';
