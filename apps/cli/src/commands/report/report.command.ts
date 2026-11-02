import path from 'node:path';
import { Command, Option } from 'nest-commander';
import { OutputFormat } from '@heimdall/core';
import { ReportSchemaVersion, type IInvestigationReport } from '@heimdall/investigation';
import { TranscriptError, TranscriptErrorCode, TranscriptStore } from '@heimdall/transcript';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliFlags } from '../../config/cli-config.model';
import { CliErrorCode } from '../../errors/cli-error-code.enum';
import { CliError } from '../../errors/cli.error';
import { renderReport } from '../../presentation/investigation-report.renderer';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

const LATEST = 'latest';

/**
 * Shows a recorded run's report again, read from its transcript: no model, no backend, no tokens.
 * The transcript is the report's only store (ADR 0007), so its retention is the report's too.
 */
@Command({
  name: 'report',
  arguments: '[run]',
  description: `Show the report of a recorded run: a transcript file, or ${LATEST} (the default)`,
})
export class ReportCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
    private readonly store: TranscriptStore,
  ) {
    super(streams);
  }

  @Option({ flags: '--json', description: 'Emit the report as one JSON object' })
  parseJson(): boolean {
    return true;
  }

  protected async execute(passedParams: string[], options: Record<string, unknown>): Promise<void> {
    const cli = this.configService.resolve(options as CliFlags);
    const file = this.locate(passedParams[0] ?? LATEST);
    const report = this.reportOf(file);

    this.streams.write(
      cli.outputFormat === OutputFormat.Json
        ? `${JSON.stringify({ ...report, transcript: file })}\n`
        : renderReport(report),
    );
  }

  private locate(run: string): string {
    if (run !== LATEST) {
      return path.resolve(run);
    }
    const latest = this.store.latest();

    if (latest === undefined) {
      throw new TranscriptError(
        TranscriptErrorCode.NotFound,
        'no recorded runs yet: investigate records every run unless --no-record is given',
      );
    }
    return latest;
  }

  private reportOf(file: string): IInvestigationReport {
    const report = this.store.read(file).outcome.report;

    if (typeof report !== 'object' || report === null) {
      throw new CliError(
        CliErrorCode.ReportNotRecorded,
        `${file} ended without a report: it ran with --plan-only, or ended in an error`,
      );
    }
    if ((report as Partial<IInvestigationReport>).schemaVersion !== ReportSchemaVersion.V1) {
      throw new CliError(
        CliErrorCode.ReportOutdated,
        `${file} was recorded by an older heimdall; heimdall replay shows what this build makes of it`,
      );
    }
    return report as IInvestigationReport;
  }
}
