import { Inject } from '@nestjs/common';
import { Command, Option } from 'nest-commander';
import { LogLevel, OutputFormat } from '@heimdall/core';
import { HEIMDALL_MANIFEST_PATH, ManifestReader } from '@heimdall/core/manifest';
import {
  InvestigationEventType,
  InvestigationInitService,
  type IEntryCandidate,
  type IInvestigationEvent,
} from '@heimdall/investigation';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliConfig, CliFlags } from '../../config/cli-config.model';
import { describeProgress, renderPlan } from '../../presentation/investigation-plan.renderer';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

interface InvestigateCommandFlags extends CliFlags {
  readonly env?: string;
  readonly since?: string;
  readonly entry?: string;
  readonly planOnly?: boolean;
}

const PROGRESS_LEVELS: ReadonlySet<LogLevel> = new Set([LogLevel.Info, LogLevel.Debug]);

@Command({
  name: 'investigate',
  arguments: '<query...>',
  description: 'Locate a reported issue in the system manifest and plan what to check (read-only)',
})
export class InvestigateCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
    private readonly reader: ManifestReader,
    @Inject(HEIMDALL_MANIFEST_PATH) private readonly manifestPath: string,
    private readonly investigations: InvestigationInitService,
  ) {
    super(streams);
  }

  @Option({
    flags: '--env <name>',
    description: 'Environment of the manifest System to investigate',
  })
  parseEnv(value: string): string {
    return value;
  }

  @Option({
    flags: '--since <duration>',
    description: 'How far back to look, e.g. 30m, 2h (default 60m)',
  })
  parseSince(value: string): string {
    return value;
  }

  @Option({
    flags: '--entry <vertex>',
    description: 'Start from this vertex, e.g. functionality:checkout, instead of asking the model',
  })
  parseEntry(value: string): string {
    return value;
  }

  @Option({ flags: '--plan-only', description: 'Stop after the plan, without running any check' })
  parsePlanOnly(): boolean {
    return true;
  }

  @Option({ flags: '--json', description: 'Emit the plan as one JSON object' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--ndjson', description: 'Emit each stage as one JSON event per line' })
  parseNdjson(): boolean {
    return true;
  }

  @Option({ flags: '--quiet', description: 'Print no progress, only the result and errors' })
  parseQuiet(): boolean {
    return true;
  }

  protected async execute(passedParams: string[], options: Record<string, unknown>): Promise<void> {
    const flags = options as InvestigateCommandFlags;
    const cli = this.configService.resolve(flags);
    const manifest = await this.reader.load(this.manifestPath);

    const plan = await this.investigations.prepare(
      manifest,
      {
        query: passedParams.join(' '),
        environment: flags.env,
        since: flags.since,
        entry: flags.entry,
      },
      {
        onEvent: (event) => this.report(event, cli),
        // Never prompt without a terminal on stdin (ADR 0006): ambiguity then exits 2.
        chooseEntry: this.streams.canPrompt() ? (candidates) => this.choose(candidates) : undefined,
      },
    );

    if (cli.outputFormat === OutputFormat.Json) {
      this.streams.write(`${JSON.stringify(plan)}\n`);
    }
    if (flags.planOnly !== true && PROGRESS_LEVELS.has(cli.logLevel)) {
      this.streams.writeDiagnostic(
        'heimdall: running checks is not available yet; stopped after the plan (ADR 0016)\n',
      );
    }
  }

  private report(event: IInvestigationEvent, cli: CliConfig): void {
    if (cli.outputFormat === OutputFormat.Ndjson) {
      this.streams.write(`${JSON.stringify(event)}\n`);
      return;
    }
    if (cli.outputFormat === OutputFormat.Text && event.type === InvestigationEventType.PlanReady) {
      this.streams.write(renderPlan(event.plan));
      return;
    }
    const progress = describeProgress(event);

    if (progress !== undefined && PROGRESS_LEVELS.has(cli.logLevel)) {
      this.streams.writeDiagnostic(`heimdall: ${progress}\n`);
    }
  }

  private async choose(candidates: readonly IEntryCandidate[]): Promise<string | undefined> {
    const options = candidates.map(
      ({ vertex, confidence, reason }, index) =>
        `  ${index + 1}. ${vertex} (${confidence.toFixed(2)}) — ${reason}`,
    );

    this.streams.writeDiagnostic(
      `heimdall: the report fits several parts of the system:\n${options.join('\n')}\n`,
    );
    const answer = await this.streams.ask(`choose 1-${candidates.length}: `);

    return candidates[Number(answer.trim()) - 1]?.vertex;
  }
}
