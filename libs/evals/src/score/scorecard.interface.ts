import type { ErrorResponse } from '@heimdall/core';
import type { ConclusionOutcome } from '@heimdall/investigation';
import type { ICalibrationState } from '../calibration/calibrator';
import type { EvalRunStatus, JudgeDimension } from '../evals.enums';
import type { ICheckResults } from './checks';
import type { IJudgeScores } from './judge';

export interface ITokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface IEvalRun {
  readonly case: string;
  /** 1-based, for `--repeat`. */
  readonly repeat: number;
  readonly status: EvalRunStatus;
  readonly exitCode: number;
  readonly outcome: ConclusionOutcome | null;
  /** The run's transcript, for `heimdall replay`. */
  readonly transcript: string | null;
  readonly error: ErrorResponse | null;
  readonly checks: ICheckResults;
  readonly scores: IJudgeScores | null;
  readonly judgeError: ErrorResponse | null;
  /** The scoring sheet written for this run, to hand-score for calibration. */
  readonly sheet: string | null;
  readonly tokens: { readonly agent: ITokens; readonly judge: ITokens };
}

/** One `heimdall eval`: every run, and whether its judge can be trusted. */
export interface IScorecard {
  readonly startedAt: string;
  /** Where the scorecard and the scoring sheets were written. */
  readonly output: string;
  readonly judge: { readonly model: string } & ICalibrationState;
  readonly runs: readonly IEvalRun[];
  readonly summary: {
    readonly runs: number;
    readonly completed: number;
    readonly checks: { readonly passed: number; readonly total: number };
    /** `null` when nothing was judged. */
    readonly meanScores: Readonly<Record<JudgeDimension, number | null>>;
    readonly tokens: ITokens;
  };
}
