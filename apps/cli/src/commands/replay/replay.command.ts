import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Command, Option } from 'nest-commander';
import { OutputFormat } from '@heimdall/core';
import { ManifestEnvVariable } from '@heimdall/core/manifest';
import {
  compareTranscripts,
  isRecordedVariable,
  TranscriptEnvVariable,
  TranscriptError,
  TranscriptErrorCode,
  TranscriptStore,
  type ITranscript,
} from '@heimdall/transcript';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliFlags } from '../../config/cli-config.model';
import { exitCodeForReplay } from '../../errors/error-exit.mapper';
import { renderReplayDiff } from '../../presentation/replay-diff.renderer';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

interface ReplayCommandFlags extends CliFlags {
  readonly strict?: boolean;
}

const STDERR_TAIL = 2_000;
const TRANSCRIPT_VARIABLES: ReadonlySet<string> = new Set(Object.values(TranscriptEnvVariable));

@Command({
  name: 'replay',
  arguments: '<transcript>',
  description:
    'Replay a recorded investigation with no model and no backend, and report where it differs',
})
export class ReplayCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
    private readonly store: TranscriptStore,
  ) {
    super(streams);
  }

  @Option({
    flags: '--strict',
    description: 'Also fail when what the model was sent differs, e.g. after a prompt change',
  })
  parseStrict(): boolean {
    return true;
  }

  @Option({ flags: '--json', description: 'Emit the comparison as one JSON object' })
  parseJson(): boolean {
    return true;
  }

  protected async execute(passedParams: string[], options: Record<string, unknown>): Promise<void> {
    const flags = options as ReplayCommandFlags;
    const cli = this.configService.resolve(flags);
    const file = path.resolve(passedParams[0] ?? '');
    const recorded = this.store.read(file);
    const diff = compareTranscripts(recorded, this.replay(file, recorded), {
      strict: flags.strict === true,
    });

    this.streams.write(
      cli.outputFormat === OutputFormat.Json
        ? `${JSON.stringify({ transcript: file, ...diff })}\n`
        : renderReplayDiff(file, diff),
    );
    process.exitCode = exitCodeForReplay(diff.outcome);
  }

  /**
   * Runs `investigate` again in a child process. Its configuration is resolved at bootstrap, so
   * the child gets the recorded variables, flags and manifest, and answers every model and source
   * call from the transcript (ADR 0007). Its working directory is empty, so no `.env` leaks in.
   */
  private replay(file: string, recorded: ITranscript): ITranscript {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'heimdall-replay-'));
    const manifest = path.join(workspace, 'manifest.yaml');
    const output = path.join(workspace, 'replayed.json');
    const { command } = recorded.meta;

    try {
      writeFileSync(manifest, recorded.meta.manifest.content);
      const child = spawnSync(
        process.execPath,
        [
          process.argv[1] ?? '',
          'investigate',
          command.query,
          '--json',
          '--quiet',
          ...(command.environment === undefined ? [] : ['--env', command.environment]),
          ...(command.since === undefined ? [] : ['--since', command.since]),
          ...(command.entry === undefined ? [] : ['--entry', command.entry]),
          ...(command.planOnly ? ['--plan-only'] : []),
        ],
        {
          cwd: workspace,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([name]) => !isRecordedVariable(name) && !TRANSCRIPT_VARIABLES.has(name),
              ),
            ),
            ...recorded.environment.variables,
            [ManifestEnvVariable.ManifestPath]: manifest,
            [TranscriptEnvVariable.Replay]: file,
            [TranscriptEnvVariable.ReplayOutput]: output,
          },
        },
      );

      if (!existsSync(output)) {
        throw new TranscriptError(
          TranscriptErrorCode.ReplayFailed,
          `the replayed run wrote no transcript (exit ${child.status ?? 'none'}): ${(child.stderr ?? '').slice(-STDERR_TAIL).trim()}`,
        );
      }
      return this.store.read(output);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}
