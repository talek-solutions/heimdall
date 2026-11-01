import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { ErrorResponse } from '@heimdall/core';
import { ManifestEnvVariable } from '@heimdall/core/manifest';
import type { IInvestigationReport } from '@heimdall/investigation';
import { TelemetryEnvVariable } from '@heimdall/telemetry';
import { isRecordedVariable, TranscriptEnvVariable } from '@heimdall/transcript';
import type { IGoldenCase } from '../cases/golden-case.interface';
import { EvalErrorCode } from '../errors';
import { EvalRunStatus } from '../evals.enums';

export type IReportWithTranscript = IInvestigationReport & { readonly transcript?: string };

export interface ICaseRun {
  readonly status: EvalRunStatus;
  readonly exitCode: number;
  readonly report?: IReportWithTranscript | undefined;
  readonly error?: ErrorResponse | undefined;
  /** The transcript the run wrote, whether it completed or failed. */
  readonly transcript?: string | undefined;
}

export interface ISpawned {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type Spawn = (args: readonly string[], env: NodeJS.ProcessEnv) => ISpawned;

const STDERR_TAIL = 2_000;

/**
 * Runs one golden case as an engineer would: `heimdall investigate --json` in its own process,
 * with the case's fixture scenario, so the fixture's bootstrap-once model holds (ADR 0014). The
 * run is recorded like any other (ADR 0007), but in a runs directory of its own, so its
 * transcript is found even when it fails, and the developer's own runs are not evicted.
 */
@Injectable()
export class CaseRunner {
  run(golden: IGoldenCase, spawn: Spawn, runsDir: string): ICaseRun {
    const child = spawn(
      [
        'investigate',
        golden.query,
        '--since',
        golden.since,
        '--json',
        '--quiet',
        ...(golden.entry === undefined ? [] : ['--entry', golden.entry]),
        ...(golden.environment === undefined ? [] : ['--env', golden.environment]),
      ],
      {
        // The developer's own INVESTIGATION_* and AGENT_* would make cases incomparable.
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !isRecordedVariable(name)),
        ),
        [ManifestEnvVariable.ManifestPath]: golden.manifest,
        [TelemetryEnvVariable.PrometheusDatasourceType]: 'fixture',
        [TelemetryEnvVariable.LokiDatasourceType]: 'fixture',
        [TelemetryEnvVariable.TempoDatasourceType]: 'fixture',
        [TelemetryEnvVariable.FixtureScenario]: golden.scenario,
        [TelemetryEnvVariable.FixtureAnchor]: golden.anchor,
        ...golden.env,
        [TranscriptEnvVariable.RunsDir]: runsDir,
      },
    );
    const exitCode = child.status ?? -1;
    const output = parsed(child.stdout);

    if (output !== undefined && typeof output['errorCode'] === 'string') {
      return {
        status: EvalRunStatus.Failed,
        exitCode,
        error: output as unknown as ErrorResponse,
        transcript: recordedIn(runsDir),
      };
    }
    if (output !== undefined && typeof output['outcome'] === 'string') {
      const report = output as unknown as IReportWithTranscript;

      return {
        status: EvalRunStatus.Completed,
        exitCode,
        report,
        transcript: report.transcript ?? recordedIn(runsDir),
      };
    }
    return {
      status: EvalRunStatus.Failed,
      exitCode,
      error: {
        errorCode: EvalErrorCode.RunFailed,
        message: `investigate wrote no report (exit ${exitCode}): ${child.stderr.slice(-STDERR_TAIL).trim()}`,
      },
      transcript: recordedIn(runsDir),
    };
  }
}

/** The default spawn: the CLI entry point the eval command itself runs from. */
export function spawnCli(entry: string, cwd: string): Spawn {
  return (args, env) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [entry, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status, stdout: stdout ?? '', stderr: stderr ?? '' };
  };
}

/** The newest transcript in a run's own directory; its file names sort by recording time. */
function recordedIn(runsDir: string): string | undefined {
  if (!existsSync(runsDir)) {
    return undefined;
  }
  const newest = readdirSync(runsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .at(-1);

  return newest === undefined ? undefined : path.join(runsDir, newest);
}

function parsed(stdout: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
