import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import { ReportSchemaVersion } from '@heimdall/investigation';
import { TranscriptErrorCode } from '@heimdall/transcript';
import { repoRoot } from '../../__fixtures__/golden';
import { CliErrorCode } from '../../errors/cli-error-code.enum';

const ENTRY = path.join(__dirname, '..', '..', 'heimdall.js');
const TRANSCRIPTS = path.join(
  repoRoot(),
  'libs',
  'investigation',
  'src',
  '__fixtures__',
  'transcripts',
);
const GOLDEN = path.join(repoRoot(), 'apps', 'cli', 'src', 'presentation', '__golden__');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-report-e2e-'));

after(() => rmSync(workspace, { recursive: true, force: true }));

/** A throwaway HOME and working directory, so nothing reads the developer's ~/.heimdall or `.env`. */
function invoke(home: string, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [ENTRY, 'report', ...args], {
    cwd: workspace,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'], HOME: home },
  });
  return { status: status ?? -1, stdout, stderr };
}

/** A committed CI transcript, optionally edited, saved as a run of a fresh HOME. */
function homeWith(
  runs: readonly { readonly name: string; readonly from: string; edit?: (t: any) => void }[],
): string {
  const home = mkdtempSync(path.join(workspace, 'home-'));
  const directory = path.join(home, '.heimdall', 'runs');

  mkdirSync(directory, { recursive: true });
  for (const { name, from, edit } of runs) {
    const transcript = JSON.parse(readFileSync(path.join(TRANSCRIPTS, `${from}.json`), 'utf8'));
    edit?.(transcript);
    writeFileSync(path.join(directory, name), JSON.stringify(transcript));
  }
  return home;
}

const OLDER = '2026-10-17T08-00-00-000Z-aaaaaa.json';
const NEWER = '2026-10-18T08-00-00-000Z-bbbbbb.json';

describe('heimdall report (end to end)', () => {
  it('prints the latest run exactly as its golden file, and exits 0', () => {
    const home = homeWith([
      { name: OLDER, from: 'error-burst-30s' },
      { name: NEWER, from: 'increased-latency-1' },
    ]);
    const { status, stdout } = invoke(home);

    assert.equal(status, ExitCode.Success);
    assert.equal(stdout, readFileSync(path.join(GOLDEN, 'increased-latency-1.txt'), 'utf8'));
  });

  it('reads a transcript by path, and emits one JSON object with its path under --json', () => {
    const home = homeWith([{ name: OLDER, from: 'payments-impact' }]);
    const file = path.join(home, '.heimdall', 'runs', OLDER);
    const { status, stdout } = invoke(home, file, '--json');
    const report = JSON.parse(stdout);

    assert.equal(status, ExitCode.Success);
    assert.equal(report.schemaVersion, ReportSchemaVersion.V1);
    assert.equal(report.transcript, file);
    assert.equal(report.impact.status, 'checked');
  });

  it('exits 2 when nothing was recorded yet', () => {
    const { status, stderr } = invoke(mkdtempSync(path.join(workspace, 'home-')));

    assert.equal(status, ExitCode.Usage);
    assert.match(stderr, new RegExp(TranscriptErrorCode.NotFound));
  });

  it('exits 2 for a run that ended without a report', () => {
    const home = homeWith([
      {
        name: OLDER,
        from: 'healthy-baseline',
        edit: (transcript) => delete transcript.outcome.report,
      },
    ]);
    const { status, stdout } = invoke(home, '--json');

    assert.equal(status, ExitCode.Usage);
    assert.equal(JSON.parse(stdout).errorCode, CliErrorCode.ReportNotRecorded);
  });

  it('exits 2 for a report recorded before schema version 1', () => {
    const home = homeWith([
      {
        name: OLDER,
        from: 'healthy-baseline',
        edit: (transcript) => delete transcript.outcome.report.schemaVersion,
      },
    ]);
    const { status, stdout } = invoke(home, '--json');

    assert.equal(status, ExitCode.Usage);
    assert.equal(JSON.parse(stdout).errorCode, CliErrorCode.ReportOutdated);
  });
});
