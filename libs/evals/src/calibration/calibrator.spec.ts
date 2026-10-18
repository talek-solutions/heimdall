import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { stringify } from 'yaml';
import { ConclusionOutcome } from '@heimdall/investigation';
import { evalsModule, scoreCall, ScriptedJudge } from '../__fixtures__/evals.fixture';
import { EvalError, EvalErrorCode } from '../errors';
import { CalibrationStatus, JudgeDimension } from '../evals.enums';
import { agreement, Calibrator, MIN_SHEETS } from './calibrator';

const root = mkdtempSync(path.join(os.tmpdir(), 'heimdall-calibration-'));
const scores = (component: number, mechanism: number, evidence: number) => ({
  [JudgeDimension.Component]: { score: component, reason: 'r' },
  [JudgeDimension.Mechanism]: { score: mechanism, reason: 'r' },
  [JudgeDimension.Evidence]: { score: evidence, reason: 'r' },
});
const human = (component: number, mechanism: number, evidence: number) => ({
  [JudgeDimension.Component]: component,
  [JudgeDimension.Mechanism]: mechanism,
  [JudgeDimension.Evidence]: evidence,
});

async function calibrator(directory: string, model = 'claude-opus-5-5'): Promise<Calibrator> {
  return (
    await evalsModule(new ScriptedJudge([scoreCall(2, 2, 1)]), {
      judgeModel: model,
      goldenDir: '.',
      calibrationDir: directory,
      outputDir: root,
    })
  ).get(Calibrator);
}

function sheets(directory: string, count: number, scored: ReturnType<typeof human>): void {
  for (let index = 0; index < count; index += 1) {
    writeFileSync(
      path.join(directory, `case-${index}.score.yaml`),
      stringify({
        case: 'increased-latency-1',
        run: `run-${index}`,
        judgeInput: {
          reference: { outcome: ConclusionOutcome.NoSignal, mechanism: 'm', evidence: [] },
          conclusion: {},
          citedResults: [],
        },
        human: scored,
      }),
    );
  }
}

describe('Calibrator (replay-and-evals.md, Calibration)', () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it('agrees when 80% or more match exactly and none is off by 2, per dimension', () => {
    const fiveOf = (judge: ReturnType<typeof scores>, misses: number) =>
      Array.from({ length: 5 }, (_, index) => ({
        human: human(2, 2, 2),
        judge: index < misses ? judge : scores(2, 2, 2),
      }));

    assert.equal(agreement(fiveOf(scores(1, 2, 2), 1)).passed, true, '4 of 5 exact, off by 1');
    assert.equal(agreement(fiveOf(scores(1, 2, 2), 2)).passed, false, '3 of 5 exact');
    assert.equal(agreement(fiveOf(scores(0, 2, 2), 1)).passed, false, 'one off by 2');
    assert.equal(agreement(fiveOf(scores(1, 2, 2), 1)).agreement[JudgeDimension.Component], 0.8);
  });

  it(`needs ${MIN_SHEETS} hand-scored sheets, and ignores blank ones`, async () => {
    const directory = mkdtempSync(path.join(root, 'small-'));
    sheets(directory, MIN_SHEETS - 1, human(2, 2, 1));
    writeFileSync(
      path.join(directory, 'blank.score.yaml'),
      stringify({
        case: 'x',
        run: 'x',
        judgeInput: {},
        human: { component: null, mechanism: null, evidence: null },
      }),
    );

    await assert.rejects(
      (await calibrator(directory)).calibrate(),
      (error: unknown) =>
        error instanceof EvalError && error.errorCode === EvalErrorCode.CalibrationTooSmall,
    );
  });

  it('trusts the judge only with a passing lock for the model in use', async () => {
    const directory = mkdtempSync(path.join(root, 'full-'));
    sheets(directory, MIN_SHEETS, human(2, 2, 1));
    const subject = await calibrator(directory);

    assert.equal(subject.state().status, CalibrationStatus.Uncalibrated, 'no lock yet');
    const lock = await subject.calibrate();

    assert.equal(lock.passed, true);
    assert.equal(subject.state().status, CalibrationStatus.Calibrated);
    assert.equal(
      JSON.parse(readFileSync(path.join(directory, 'judge.lock.json'), 'utf8')).sheets,
      MIN_SHEETS,
    );
    assert.equal(
      (await calibrator(directory, 'claude-sonnet-5-5')).state().status,
      CalibrationStatus.Uncalibrated,
      'a lock counts only for its own judge model',
    );
  });
});
