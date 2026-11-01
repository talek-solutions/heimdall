import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { parse } from 'yaml';
import { TranscriptEnvVariable } from '@heimdall/transcript';
import { evalsModule, scoreCall, ScriptedJudge } from './__fixtures__/evals.fixture';
import { CalibrationStatus, CheckResult, EvalCheck, EvalRunStatus } from './evals.enums';
import { EvalService } from './eval.service';
import type { Spawn } from './run/case.runner';

const root = mkdtempSync(path.join(os.tmpdir(), 'heimdall-eval-'));
const GOLDEN = path.resolve(__dirname, '..', 'golden');

/** What the triage call of a real run spent; the committed transcript skipped triage (--entry). */
const TRIAGE_USAGE = { inputTokens: 1449, outputTokens: 238 };

interface ICommittedTranscript {
  readonly model: ReadonlyArray<Record<string, unknown> & { readonly response?: object }>;
  readonly outcome: {
    readonly report: Record<string, unknown> & {
      readonly usage: { inputTokens: number; outputTokens: number };
    };
  };
}

/** The committed scripted-model transcript of error-burst-30s: triage, then the agent. */
function committedTranscriptPath(): string {
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
  return path.join(directory, relative);
}

function committedTranscript(): ICommittedTranscript {
  return JSON.parse(readFileSync(committedTranscriptPath(), 'utf8')) as ICommittedTranscript;
}

/** Its report, as investigate prints it. */
function recordedReport(transcript = '/runs/error-burst-30s.json'): string {
  return JSON.stringify({ ...committedTranscript().outcome.report, transcript });
}

/**
 * Records the committed transcript where the run was told to, as investigate would, with a
 * triage call ahead of the agent's.
 */
function record(env: NodeJS.ProcessEnv): string {
  const runsDir = env[TranscriptEnvVariable.RunsDir] ?? '';
  const file = path.join(runsDir, '2026-10-31T19-06-51-000Z-abc123.json');
  const transcript = committedTranscript();
  const [first] = transcript.model;
  const triage = { ...first, call: 0, response: { ...first?.response, usage: TRIAGE_USAGE } };

  mkdirSync(runsDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ ...transcript, model: [triage, ...transcript.model] }));
  return file;
}

function modeOf(file: string): number {
  return statSync(file).mode & 0o777;
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

  it('gives each run its own runs directory and counts every model call, triage too', async () => {
    const { evals } = await service();
    const envs: NodeJS.ProcessEnv[] = [];
    const spawn: Spawn = (_args, env) => {
      envs.push(env);
      return { status: 0, stdout: `${recordedReport(record(env))}\n`, stderr: '' };
    };
    const scorecard = await evals.run({ cases: ['error-burst-30s'], repeat: 1, spawn });
    const { usage } = committedTranscript().outcome.report;

    assert.equal(
      envs[0]?.[TranscriptEnvVariable.RunsDir],
      path.join(scorecard.output, 'runs', 'error-burst-30s-1'),
    );
    assert.deepEqual(scorecard.runs[0]?.tokens.investigation, {
      inputTokens: usage.inputTokens + TRIAGE_USAGE.inputTokens,
      outputTokens: usage.outputTokens + TRIAGE_USAGE.outputTokens,
    });
  });

  it('finds the transcript of a run that ended in error, and counts what it spent', async () => {
    const { evals } = await service();
    let file = '';
    const spawn: Spawn = (_args, env) => {
      file = record(env);
      return {
        status: 2,
        stdout: '{"errorCode":"INVESTIGATION_ENTRY_AMBIGUOUS","message":"several fit"}\n',
        stderr: '',
      };
    };
    const scorecard = await evals.run({ cases: ['healthy-baseline'], repeat: 1, spawn });

    assert.equal(scorecard.runs[0]?.status, EvalRunStatus.Failed);
    assert.equal(scorecard.runs[0]?.transcript, file);
    assert.ok((scorecard.runs[0]?.tokens.investigation.inputTokens ?? 0) > 0);
  });

  it('keeps the scorecard and the sheets readable by the owner alone', async () => {
    const { evals } = await service();
    const spawn: Spawn = () => ({ status: 0, stdout: `${recordedReport()}\n`, stderr: '' });
    const scorecard = await evals.run({ cases: ['error-burst-30s'], repeat: 1, spawn });

    assert.equal(modeOf(scorecard.output), 0o700);
    assert.equal(modeOf(path.join(scorecard.output, 'sheets')), 0o700);
    assert.equal(modeOf(path.join(scorecard.output, 'scorecard.json')), 0o600);
    assert.equal(modeOf(scorecard.runs[0]?.sheet ?? ''), 0o600);
  });
});
