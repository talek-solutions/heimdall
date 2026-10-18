import { Command, Option } from 'nest-commander';
import { LogLevel, OutputFormat } from '@heimdall/core';
import { Calibrator, EvalService, spawnCli } from '@heimdall/evals';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliFlags } from '../../config/cli-config.model';
import { CliError, CliErrorCode } from '../../errors';
import {
  describeEvalRun,
  renderCalibration,
  renderScorecard,
} from '../../presentation/scorecard.renderer';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

interface EvalCommandFlags extends CliFlags {
  readonly case?: readonly string[];
  readonly repeat?: string;
  readonly calibrate?: boolean;
}

const PROGRESS_LEVELS: ReadonlySet<LogLevel> = new Set([LogLevel.Info, LogLevel.Debug]);

@Command({
  name: 'eval',
  description:
    'Run the golden cases with the real model and score them against their reference answers (spends tokens)',
})
export class EvalCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
    private readonly evals: EvalService,
    private readonly calibrator: Calibrator,
  ) {
    super(streams);
  }

  @Option({
    flags: '--case <names...>',
    description: 'Only these golden cases, by name (default: all)',
  })
  parseCase(value: string, previous: readonly string[] = []): readonly string[] {
    return [...previous, value];
  }

  @Option({
    flags: '--repeat <n>',
    description: 'Run each case n times to see its variance (default 1)',
  })
  parseRepeat(value: string): string {
    return value;
  }

  @Option({
    flags: '--calibrate',
    description: 'Judge the hand-scored sheets and record whether the judge can be trusted',
  })
  parseCalibrate(): boolean {
    return true;
  }

  @Option({ flags: '--json', description: 'Emit the scorecard as one JSON object' })
  parseJson(): boolean {
    return true;
  }

  protected async execute(
    _passedParams: string[],
    options: Record<string, unknown>,
  ): Promise<void> {
    const flags = options as EvalCommandFlags;
    const cli = this.configService.resolve(flags);
    const json = cli.outputFormat === OutputFormat.Json;

    if (flags.calibrate === true) {
      const lock = await this.calibrator.calibrate();
      this.streams.write(json ? `${JSON.stringify(lock)}\n` : renderCalibration(lock));
      return;
    }
    const cases = this.evals.cases(flags.case ?? []);
    const repeat = Number(flags.repeat ?? '1');

    if (!Number.isInteger(repeat) || repeat < 1) {
      throw new CliError(
        CliErrorCode.InvalidFlagValue,
        `--repeat must be a whole number of at least 1, got '${flags.repeat ?? ''}'`,
      );
    }
    const progress = PROGRESS_LEVELS.has(cli.logLevel);

    if (progress) {
      this.streams.writeDiagnostic(
        `heimdall: eval runs ${cases.length * repeat} investigations and as many judge calls with real models; this spends tokens\n`,
      );
    }
    const scorecard = await this.evals.run({
      cases: cases.map(({ name }) => name),
      repeat,
      // The CLI that runs this command runs each case, from the same working directory and .env.
      spawn: spawnCli(process.argv[1] ?? '', process.cwd()),
      onRun: progress
        ? (run) => this.streams.writeDiagnostic(`heimdall: ${describeEvalRun(run)}\n`)
        : undefined,
    });

    this.streams.write(json ? `${JSON.stringify(scorecard)}\n` : renderScorecard(scorecard));
  }
}
