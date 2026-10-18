import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import { CalibrationStatus, EvalErrorCode, EvalEnvVariable, EvalRunStatus } from '@heimdall/evals';
import { LlmErrorCode } from '@heimdall/llm';
import { CliErrorCode } from '../../errors';

const ENTRY = path.join(__dirname, '..', '..', 'heimdall.js');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-eval-e2e-'));

after(() => rmSync(workspace, { recursive: true, force: true }));

/** No API key, a throwaway HOME and working directory: nothing spends tokens or reads ~/.heimdall. */
function invoke(env: NodeJS.ProcessEnv, ...args: string[]) {
  const { status, stdout } = spawnSync(process.execPath, [ENTRY, 'eval', ...args, '--json'], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'], HOME: mkdtempSync(path.join(workspace, 'home-')), ...env },
  });
  return { status: status ?? -1, json: JSON.parse(stdout) as Record<string, unknown> };
}

describe('heimdall eval (end to end, without tokens)', () => {
  it('runs a golden case as investigate does, and reports the failed run in the scorecard', () => {
    const { status, json } = invoke({}, '--case', 'error-burst-30s');
    const [run] = json['runs'] as Array<{ status: string; error: { errorCode: string } }>;

    assert.equal(status, ExitCode.Success);
    assert.equal(run?.status, EvalRunStatus.Failed);
    assert.equal(run?.error.errorCode, LlmErrorCode.MISSING_API_KEY);
    assert.equal((json['judge'] as { status: string }).status, CalibrationStatus.Uncalibrated);
  });

  it('refuses an unknown case and a repeat below 1, with exit 2', () => {
    const unknown = invoke({}, '--case', 'nope');
    const repeat = invoke({}, '--repeat', '0');

    assert.equal(unknown.status, ExitCode.Usage);
    assert.equal(unknown.json['errorCode'], EvalErrorCode.CaseNotFound);
    assert.equal(repeat.status, ExitCode.Usage);
    assert.equal(repeat.json['errorCode'], CliErrorCode.InvalidFlagValue);
  });

  it('will not calibrate without enough hand-scored sheets', () => {
    const { status, json } = invoke(
      { [EvalEnvVariable.CalibrationDir]: mkdtempSync(path.join(workspace, 'calibration-')) },
      '--calibrate',
    );

    assert.equal(status, ExitCode.Usage);
    assert.equal(json['errorCode'], EvalErrorCode.CalibrationTooSmall);
  });
});
