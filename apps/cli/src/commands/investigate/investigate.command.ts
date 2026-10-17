import { Inject } from '@nestjs/common';
import { Command, Option } from 'nest-commander';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { LogLevel, OutputFormat } from '@heimdall/core';
import { HEIMDALL_MANIFEST_PATH, ManifestReader } from '@heimdall/core/manifest';
import {
  InvestigationEventType,
  InvestigationExecutionService,
  InvestigationInitService,
  type IEntryCandidate,
  type IInvestigationEvent,
} from '@heimdall/investigation';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliConfig, CliFlags } from '../../config/cli-config.model';
import { exitCodeForOutcome } from '../../errors/error-exit.mapper';
import { describeProgress, renderPlan } from '../../presentation/investigation-plan.renderer';
import { renderReport } from '../../presentation/investigation-report.renderer';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

interface InvestigateCommandFlags extends CliFlags {
  readonly env?: string;
  readonly since?: string;
  readonly entry?: string;
  readonly planOnly?: boolean;
}

const PROGRESS_LEVELS: ReadonlySet<LogLevel> = new Set([LogLevel.Info, LogLevel.Debug]);
const tracer = trace.getTracer('@heimdall/cli');

enum InvestigationSpanAttribute {
  PlanOnly = 'heimdall.investigation.plan_only',
  Outcome = 'heimdall.investigation.outcome',
}

@Command({
  name: 'investigate',
  arguments: '<query...>',
  description:
    'Locate a reported issue in the system manifest, plan what to check, and investigate it (read-only)',
})
export class InvestigateCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
    private readonly reader: ManifestReader,
    @Inject(HEIMDALL_MANIFEST_PATH) private readonly manifestPath: string,
    private readonly investigations: InvestigationInitService,
    private readonly executions: InvestigationExecutionService,
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
    const planOnly = flags.planOnly === true;
    const onEvent = (event: IInvestigationEvent): void => this.report(event, cli);

    // The root of the run's trace: init, the agent and every query nest under it (ADR 0017).
    await tracer.startActiveSpan(
      'investigation',
      { attributes: { [InvestigationSpanAttribute.PlanOnly]: planOnly } },
      async (span) => {
        try {
          const plan = await this.investigations.prepare(
            manifest,
            {
              query: passedParams.join(' '),
              environment: flags.env,
              since: flags.since,
              entry: flags.entry,
            },
            {
              onEvent,
              // Never prompt without a terminal on stdin (ADR 0006): ambiguity then exits 2.
              chooseEntry: this.streams.canPrompt()
                ? (candidates) => this.choose(candidates)
                : undefined,
            },
          );

          if (planOnly) {
            if (cli.outputFormat === OutputFormat.Json) {
              this.streams.write(`${JSON.stringify(plan)}\n`);
            }
            return;
          }
          const report = await this.executions.execute(manifest, plan, { onEvent });

          span.setAttribute(InvestigationSpanAttribute.Outcome, report.outcome);
          if (cli.outputFormat === OutputFormat.Json) {
            this.streams.write(`${JSON.stringify(report)}\n`);
          }
          // 0 for a cause, 3 for no signal or no conclusion: a real outcome, not a failure.
          process.exitCode = exitCodeForOutcome(report.outcome);
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      },
    );
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
    if (cli.outputFormat === OutputFormat.Text && event.type === InvestigationEventType.Concluded) {
      this.streams.write(renderReport(event.report));
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
