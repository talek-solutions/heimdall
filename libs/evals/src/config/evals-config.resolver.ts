import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { heimdallHomeDir } from '@heimdall/core';
import { EvalEnvVariable } from '../evals.enums';
import type { IEvalsConfig } from './evals-config.model';

export const DEFAULT_JUDGE_MODEL = 'claude-opus-5-5';
const EVALS_DIRNAME = 'evals';
/** dist/config → the package, where `golden/` and `calibration/` live. */
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

export function resolveEvalsConfig(config: ConfigService): IEvalsConfig {
  const dir = (variable: EvalEnvVariable, fallback: string): string =>
    path.resolve(config.get<string>(variable) || fallback);

  return {
    judgeModel: config.get<string>(EvalEnvVariable.JudgeModel) || DEFAULT_JUDGE_MODEL,
    goldenDir: dir(EvalEnvVariable.GoldenDir, path.join(PACKAGE_ROOT, 'golden')),
    calibrationDir: dir(EvalEnvVariable.CalibrationDir, path.join(PACKAGE_ROOT, 'calibration')),
    outputDir: dir(EvalEnvVariable.OutputDir, path.join(heimdallHomeDir(), EVALS_DIRNAME)),
  };
}
