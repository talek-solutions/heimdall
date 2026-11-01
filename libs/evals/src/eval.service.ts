import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { decodeTranscript } from '@heimdall/transcript';
import { Calibrator } from './calibration/calibrator';
import type { IGoldenCase } from './cases/golden-case.interface';
import { GoldenCaseLoader } from './cases/golden-case.loader';
import type { IEvalsConfig } from './config/evals-config.model';
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './evals.constants';
import { CheckResult, EvalRunStatus, JudgeDimension } from './evals.enums';
import { EVALS_CONFIG } from './evals.tokens';
import { CaseRunner, type ICaseRun, type Spawn } from './run/case.runner';
import { checkRun } from './score/checks';
import { Judge, judgeInput } from './score/judge';
import type { IEvalRun, IScorecard, ITokens } from './score/scorecard.interface';

const SHEETS_DIRNAME = 'sheets';
const RUNS_DIRNAME = 'runs';
const SCORECARD_FILE = 'scorecard.json';
const NO_TOKENS: ITokens = { inputTokens: 0, outputTokens: 0 };

export interface IEvalOptions {
  readonly cases: readonly string[];
  readonly repeat: number;
  readonly spawn: Spawn;
  readonly onRun?: ((run: IEvalRun) => void) | undefined;
}

/**
 * `heimdall eval` (ADR 0007): each golden case runs as a real investigation, is checked by code,
 * and is scored by the judge. Spends real tokens, so it only ever runs on demand.
 */
@Injectable()
export class EvalService {
  constructor(
    private readonly loader: GoldenCaseLoader,
    private readonly runner: CaseRunner,
    private readonly judge: Judge,
    private readonly calibrator: Calibrator,
    @Inject(EVALS_CONFIG) private readonly config: IEvalsConfig,
  ) {}

  cases(names: readonly string[]): IGoldenCase[] {
    return this.loader.load(names);
  }

  async run(options: IEvalOptions): Promise<IScorecard> {
    const startedAt = new Date().toISOString();
    const output = path.join(this.config.outputDir, startedAt.replace(/[:.]/g, '-'));
    const runs: IEvalRun[] = [];

    mkdirSync(path.join(output, SHEETS_DIRNAME), {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
    for (const golden of this.loader.load(options.cases)) {
      for (let repeat = 1; repeat <= options.repeat; repeat += 1) {
        const run = await this.evaluate(golden, repeat, options.spawn, output);

        runs.push(run);
        options.onRun?.(run);
      }
    }
    const scorecard: IScorecard = {
      startedAt,
      output,
      judge: { model: this.config.judgeModel, ...this.calibrator.state() },
      runs,
      summary: summarise(runs),
    };

    writeFileSync(path.join(output, SCORECARD_FILE), `${JSON.stringify(scorecard, null, 2)}\n`, {
      mode: PRIVATE_FILE_MODE,
    });
    return scorecard;
  }

  private async evaluate(
    golden: IGoldenCase,
    repeat: number,
    spawn: Spawn,
    output: string,
  ): Promise<IEvalRun> {
    const name = `${golden.name}-${repeat}`;
    const run = this.runner.run(golden, spawn, path.join(output, RUNS_DIRNAME, name));
    const checks = checkRun(golden.reference, run);
    const input = run.report === undefined ? undefined : judgeInput(golden.reference, run.report);
    const judgement = input === undefined ? undefined : await this.judge.score(input);
    const sheet =
      input === undefined
        ? null
        : this.calibrator.writeSheet(path.join(output, SHEETS_DIRNAME), name, {
            case: golden.name,
            run: run.transcript ?? `${golden.name} #${repeat}`,
            judgeInput: input,
            // Blank on purpose: the judge's scores are not shown, so they cannot anchor yours.
            human: {
              [JudgeDimension.Component]: null,
              [JudgeDimension.Mechanism]: null,
              [JudgeDimension.Evidence]: null,
            },
          });

    return {
      case: golden.name,
      repeat,
      status: run.status,
      exitCode: run.exitCode,
      outcome: run.report?.outcome ?? null,
      transcript: run.transcript ?? null,
      error: run.error ?? null,
      checks,
      scores: judgement?.scores ?? null,
      judgeError: judgement?.error ?? null,
      sheet,
      tokens: { investigation: spent(run), judge: judgement?.usage ?? NO_TOKENS },
    };
  }
}

/**
 * Every model call the run recorded, triage included. Without a readable transcript, only the
 * agent's usage from the report is known.
 */
function spent(run: ICaseRun): ITokens {
  const recorded = run.transcript === undefined ? undefined : recordedSpend(run.transcript);

  if (recorded !== undefined) {
    return recorded;
  }
  return run.report === undefined
    ? NO_TOKENS
    : {
        inputTokens: run.report.usage.inputTokens,
        outputTokens: run.report.usage.outputTokens,
      };
}

function recordedSpend(file: string): ITokens | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    return decodeTranscript(readFileSync(file, 'utf8'), file).model.reduce(
      (total, { response }) => ({
        inputTokens: total.inputTokens + (response?.usage.inputTokens ?? 0),
        outputTokens: total.outputTokens + (response?.usage.outputTokens ?? 0),
      }),
      NO_TOKENS,
    );
  } catch {
    return undefined;
  }
}

function summarise(runs: readonly IEvalRun[]): IScorecard['summary'] {
  const checks = runs.flatMap((run) =>
    Object.values(run.checks).filter((result) => result !== CheckResult.NotApplicable),
  );
  const judged = runs.flatMap((run) => (run.scores === null ? [] : [run.scores]));
  const mean = (name: JudgeDimension): number | null =>
    judged.length === 0
      ? null
      : Number(
          (judged.reduce((total, scores) => total + scores[name].score, 0) / judged.length).toFixed(
            2,
          ),
        );

  return {
    runs: runs.length,
    completed: runs.filter((run) => run.status === EvalRunStatus.Completed).length,
    checks: {
      passed: checks.filter((result) => result === CheckResult.Pass).length,
      total: checks.length,
    },
    meanScores: {
      [JudgeDimension.Component]: mean(JudgeDimension.Component),
      [JudgeDimension.Mechanism]: mean(JudgeDimension.Mechanism),
      [JudgeDimension.Evidence]: mean(JudgeDimension.Evidence),
    },
    tokens: {
      inputTokens: runs.reduce(
        (total, run) =>
          total + run.tokens.investigation.inputTokens + run.tokens.judge.inputTokens,
        0,
      ),
      outputTokens: runs.reduce(
        (total, run) =>
          total + run.tokens.investigation.outputTokens + run.tokens.judge.outputTokens,
        0,
      ),
    },
  };
}
