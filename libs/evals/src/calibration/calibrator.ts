import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { parse, stringify } from 'yaml';
import type { IEvalsConfig } from '../config/evals-config.model';
import { EvalError, EvalErrorCode } from '../errors';
import { CalibrationStatus, JudgeDimension } from '../evals.enums';
import { EVALS_CONFIG } from '../evals.tokens';
import { Judge, type IJudgeInput, type IJudgeScores } from '../score/judge';

/** `.docs/design/replay-and-evals.md`, Calibration. */
export const MIN_SHEETS = 5;
export const MIN_AGREEMENT = 0.8;
export const MAX_DEVIATION = 1;
const LOCK_FILE = 'judge.lock.json';
const SHEET_FILE = /\.score\.ya?ml$/;

/** A run to be hand-scored: what the judge sees, and blanks for a person to fill in. */
export interface IScoringSheet {
  readonly case: string;
  readonly run: string;
  readonly judgeInput: IJudgeInput;
  readonly human: Readonly<Record<JudgeDimension, number | null>>;
  readonly note?: string | undefined;
}

export interface ICalibrationLock {
  readonly judgeModel: string;
  readonly calibratedAt: string;
  readonly sheets: number;
  /** Per dimension, the share of sheets where the judge gave the hand score exactly. */
  readonly agreement: Readonly<Record<JudgeDimension, number>>;
  /** Per dimension, the largest difference between the judge and the hand score. */
  readonly maxDeviation: Readonly<Record<JudgeDimension, number>>;
  readonly passed: boolean;
}

export interface ICalibrationState {
  readonly status: CalibrationStatus;
  readonly lock?: ICalibrationLock | undefined;
}

/**
 * Whether the judge can be trusted (ADR 0007): its scores against hand scores on a small set.
 * A passing lock counts only for the judge model it was made with.
 */
@Injectable()
export class Calibrator {
  constructor(
    private readonly judge: Judge,
    @Inject(EVALS_CONFIG) private readonly config: IEvalsConfig,
  ) {}

  state(): ICalibrationState {
    const file = path.join(this.config.calibrationDir, LOCK_FILE);

    if (!existsSync(file)) {
      return { status: CalibrationStatus.Uncalibrated };
    }
    const lock = JSON.parse(readFileSync(file, 'utf8')) as ICalibrationLock;
    const trusted = lock.passed && lock.judgeModel === this.config.judgeModel;

    return {
      status: trusted ? CalibrationStatus.Calibrated : CalibrationStatus.Uncalibrated,
      lock,
    };
  }

  /** Judges every hand-scored sheet, measures agreement, and writes the lock. */
  async calibrate(): Promise<ICalibrationLock> {
    const sheets = this.sheets().filter((sheet) =>
      Object.values(sheet.human).every((score) => typeof score === 'number'),
    );

    if (sheets.length < MIN_SHEETS) {
      throw new EvalError(
        EvalErrorCode.CalibrationTooSmall,
        `calibration needs at least ${MIN_SHEETS} hand-scored sheets in ${this.config.calibrationDir}; found ${sheets.length}`,
      );
    }
    const pairs: Array<{ readonly human: IScoringSheet['human']; readonly judge: IJudgeScores }> =
      [];

    for (const sheet of sheets) {
      const judgement = await this.judge.score(sheet.judgeInput);

      if (judgement.scores === undefined) {
        throw new EvalError(
          EvalErrorCode.CaseInvalid,
          `the judge could not score ${sheet.case} (${sheet.run}): ${judgement.error?.errorCode ?? 'unknown'}`,
        );
      }
      pairs.push({ human: sheet.human, judge: judgement.scores });
    }
    const lock: ICalibrationLock = {
      judgeModel: this.config.judgeModel,
      calibratedAt: new Date().toISOString(),
      sheets: pairs.length,
      ...agreement(pairs),
    };

    writeFileSync(
      path.join(this.config.calibrationDir, LOCK_FILE),
      `${JSON.stringify(lock, null, 2)}\n`,
    );
    return lock;
  }

  writeSheet(directory: string, name: string, sheet: IScoringSheet): string {
    const file = path.join(directory, `${name}.score.yaml`);

    writeFileSync(
      file,
      `# Hand-score this run: 0, 1 or 2 per dimension (rubric: .docs/design/replay-and-evals.md).\n# Then move it to libs/evals/calibration/ and run heimdall eval --calibrate.\n${stringify(sheet)}`,
    );
    return file;
  }

  private sheets(): IScoringSheet[] {
    return readdirSync(this.config.calibrationDir)
      .filter((file) => SHEET_FILE.test(file))
      .sort()
      .map((file) => {
        const sheet = parse(readFileSync(path.join(this.config.calibrationDir, file), 'utf8')) as
          IScoringSheet | undefined;

        if (sheet?.human === undefined || sheet.judgeInput === undefined) {
          throw new EvalError(EvalErrorCode.CaseInvalid, `${file}: not a scoring sheet`);
        }
        return sheet;
      });
  }
}

/** Exact agreement and the largest deviation per dimension; passes when every dimension does. */
export function agreement(
  pairs: readonly { readonly human: IScoringSheet['human']; readonly judge: IJudgeScores }[],
): Pick<ICalibrationLock, 'agreement' | 'maxDeviation' | 'passed'> {
  const dimensions = Object.values(JudgeDimension);
  const exact = Object.fromEntries(
    dimensions.map((name) => [
      name,
      pairs.filter(({ human, judge }) => human[name] === judge[name].score).length / pairs.length,
    ]),
  ) as Record<JudgeDimension, number>;
  const deviation = Object.fromEntries(
    dimensions.map((name) => [
      name,
      Math.max(
        ...pairs.map(({ human, judge }) => Math.abs((human[name] ?? 0) - judge[name].score)),
      ),
    ]),
  ) as Record<JudgeDimension, number>;

  return {
    agreement: exact,
    maxDeviation: deviation,
    passed: dimensions.every(
      (name) => exact[name] >= MIN_AGREEMENT && deviation[name] <= MAX_DEVIATION,
    ),
  };
}
