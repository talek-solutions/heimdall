import {
  CalibrationStatus,
  EvalCheck,
  EvalRunStatus,
  JudgeDimension,
  MIN_AGREEMENT,
  type ICalibrationLock,
  type IEvalRun,
  type IScorecard,
} from '@heimdall/evals';

const CHECKS = Object.values(EvalCheck);
const DIMENSIONS = Object.values(JudgeDimension);
const CASE_WIDTH = 22;
const COLUMN = 11;

/** One progress line per finished run. */
export function describeEvalRun(run: IEvalRun): string {
  const what = `${run.case} #${run.repeat}`;

  if (run.status === EvalRunStatus.Failed) {
    return `${what}: failed, ${run.error?.errorCode ?? 'unknown'}`;
  }
  const scores =
    run.scores === null
      ? `judge ${run.judgeError?.errorCode ?? 'unknown'}`
      : DIMENSIONS.map((name) => `${name} ${run.scores?.[name].score}`).join(', ');
  return `${what}: ${run.outcome ?? 'no outcome'} · ${CHECKS.map((name) => `${name} ${run.checks[name]}`).join(', ')} · ${scores}`;
}

/** The scorecard for a terminal: one row per run, the means, and whether to trust the judge. */
export function renderScorecard(scorecard: IScorecard): string {
  const { judge, runs, summary } = scorecard;
  const header = [
    'case'.padEnd(CASE_WIDTH),
    ...[...CHECKS, ...DIMENSIONS].map((name) => name.padEnd(COLUMN)),
    'tokens in / out',
  ];
  const lines = [
    `eval          ${summary.runs} runs · judge ${judge.model} · ${judge.status}`,
    '',
    header.join(''),
    ...runs.map((run) => row(run)),
    '',
    `checks        ${summary.checks.passed} of ${summary.checks.total} passed`,
    `mean scores   ${DIMENSIONS.map((name) => `${name} ${summary.meanScores[name] ?? '–'}`).join(' · ')} (of 2)`,
    `tokens        ${summary.tokens.inputTokens} in / ${summary.tokens.outputTokens} out`,
    `written to    ${scorecard.output}`,
  ];

  for (const run of runs.filter(({ error, judgeError }) => error !== null || judgeError !== null)) {
    const failure = run.error ?? run.judgeError;
    lines.push(
      `failed        ${run.case} #${run.repeat}: ${failure?.errorCode}${failure?.message === undefined ? '' : ` — ${failure.message}`}`,
    );
  }
  if (judge.status === CalibrationStatus.Uncalibrated) {
    lines.push(
      '',
      `The judge is uncalibrated${judge.lock === undefined ? '' : ` (the lock is for ${judge.lock.judgeModel}${judge.lock.passed ? '' : ' and did not pass'})`}: do not trust its scores yet.`,
      `Hand-score the sheets in ${scorecard.output}/sheets, move them to libs/evals/calibration, and run heimdall eval --calibrate.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderCalibration(lock: ICalibrationLock): string {
  const lines = [
    `calibration   ${lock.passed ? 'passed' : 'failed'} · judge ${lock.judgeModel} · ${lock.sheets} hand-scored sheets`,
    ...DIMENSIONS.map(
      (name) =>
        `  ${name.padEnd(COLUMN)}${Math.round(lock.agreement[name] * 100)}% exact (needs ${Math.round(MIN_AGREEMENT * 100)}%), off by at most ${lock.maxDeviation[name]}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

function row(run: IEvalRun): string {
  const cells = [
    ...CHECKS.map((name) => run.checks[name]),
    ...DIMENSIONS.map((name) => (run.scores === null ? '–' : String(run.scores[name].score))),
  ];
  const tokens = run.tokens.agent.inputTokens + run.tokens.judge.inputTokens;
  const output = run.tokens.agent.outputTokens + run.tokens.judge.outputTokens;

  return [
    `${run.case} #${run.repeat}`.padEnd(CASE_WIDTH),
    ...cells.map((cell) => cell.padEnd(COLUMN)),
    `${tokens} / ${output}`,
  ].join('');
}
