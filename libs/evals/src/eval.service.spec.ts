import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { parse } from 'yaml';
import { evalsModule, scoreCall, ScriptedJudge } from './__fixtures__/evals.fixture';
import { CalibrationStatus, CheckResult, EvalCheck, EvalRunStatus } from './evals.enums';
import { EvalService } from './eval.service';
import type { Spawn } from './run/case.runner';

const root = mkdtempSync(path.join(os.tmpdir(), 'heimdall-eval-'));
const GOLDEN = path.resolve(__dirname, '..', 'golden');

/** The report of the committed scripted-model transcript of error-burst-30s, as investigate prints it. */
function recordedReport(): string {
  let directory = __dirname;
  const relative = path.join(
    'libs',
    'investigation',
    'src',
    '__fixtures__',
    'transcripts',
    'error-burst-30s.json',
  );

  while (!existsSync(path.join(directory, relative))) {
    directory = path.dirname(directory);
  }
  const transcript = JSON.parse(readFileSync(path.join(directory, relative), 'utf8')) as {
    outcome: { report: Record<string, unknown> };
  };
  return JSON.stringify({ ...transcript.outcome.report, transcript: '/runs/error-burst-30s.json' });
}

async function service(): Promise<{ evals: EvalService; judge: ScriptedJudge }> {
  const judge = new ScriptedJudge([scoreCall(2, 2, 1)]);
  const moduleRef = await evalsModule(judge, {
    judgeModel: 'claude-opus-5-5',
    goldenDir: GOLDEN,
    calibrationDir: mkdtempSync(path.join(root, 'calibration-')),
    outputDir: root,
  });
  return { evals: moduleRef.get(EvalService), judge };
}

describe('EvalService (replay-and-evals.md, Golden cases)', () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it('runs each case as investigate would, checks it, judges it, and writes a sheet to hand-score', async () => {
    const { evals, judge } = await service();
    const calls: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const spawn: Spawn = (args, env) => {
      calls.push({ args, env });
      return { status: 0, stdout: `${recordedReport()}\n`, stderr: '' };
    };
    const scorecard = await evals.run({ cases: ['error-burst-30s'], repeat: 2, spawn });
    const [first] = scorecard.runs;
    const sheet = parse(readFileSync(first?.sheet ?? '', 'utf8')) as {
      human: Record<string, unknown>;
    };

    assert.deepEqual(calls[0]?.args.slice(0, 4), [
      'investigate',
      'checkouts are not working',
      '--since',
      '2m',
    ]);
    assert.equal(calls[0]?.env['TELEMETRY_FIXTURE_SCENARIO'], 'error-burst-30s');
    assert.equal(calls[0]?.env['PROMETHEUS_DATASOURCE_TYPE'], 'fixture');
    assert.equal(scorecard.runs.length, 2);
    assert.equal(first?.status, EvalRunStatus.Completed);
    assert.deepEqual(first?.checks, {
      [EvalCheck.Outcome]: CheckResult.Pass,
      [EvalCheck.Origin]: CheckResult.Pass,
      [EvalCheck.Cause]: CheckResult.Pass,
    });
    assert.equal(first?.scores?.evidence.score, 1);
    assert.equal(first?.transcript, '/runs/error-burst-30s.json');
    assert.deepEqual(sheet.human, { component: null, mechanism: null, evidence: null });
    assert.equal(scorecard.judge.status, CalibrationStatus.Uncalibrated);
    assert.deepEqual(scorecard.summary.checks, { passed: 6, total: 6 });
    assert.equal(scorecard.summary.meanScores.evidence, 1);
    assert.ok(existsSync(path.join(scorecard.output, 'scorecard.json')));
    assert.equal(judge.requests.length, 2);
  });

  it('records a run that ended in error, and does not ask the judge about it', async () => {
    const { evals, judge } = await service();
    const spawn: Spawn = () => ({
      status: 4,
      stdout: '{"errorCode":"LLM_MISSING_API_KEY","message":"no key"}\n',
      stderr: '',
    });
    const scorecard = await evals.run({ cases: ['healthy-baseline'], repeat: 1, spawn });

    assert.equal(scorecard.runs[0]?.status, EvalRunStatus.Failed);
    assert.equal(scorecard.runs[0]?.error?.errorCode, 'LLM_MISSING_API_KEY');
    assert.equal(scorecard.runs[0]?.sheet, null);
    assert.equal(judge.requests.length, 0);
  });
});
