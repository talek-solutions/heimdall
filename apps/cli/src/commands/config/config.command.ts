import { Command, Option } from 'nest-commander';
import { OutputFormat } from '@heimdall/core';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliFlags } from '../../config/cli-config.model';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

interface ConfigSummary {
  readonly configPath: string;
  readonly backends: readonly string[];
  readonly queries: readonly string[];
  readonly scrubbers: readonly string[];
}

@Command({
  name: 'config',
  description: 'Validate the Heimdall configuration and summarise it',
})
export class ConfigCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
  ) {
    super(streams);
  }

  @Option({
    flags: '-c, --config <path>',
    description: 'Path to the config file (default: ./heimdall.yaml)',
  })
  parseConfigPath(value: string): string {
    return value;
  }

  @Option({ flags: '--json', description: 'Emit the summary as JSON' })
  parseJson(): boolean {
    return true;
  }

  protected async execute(
    _passedParams: string[],
    options: Record<string, unknown>,
  ): Promise<void> {
    const flags = options as CliFlags;
    const cli = this.configService.resolve(flags);
    const config = this.configService.load(cli.configPath);

    const summary: ConfigSummary = {
      configPath: cli.configPath,
      backends: config.backends.map((backend) => `${backend.name} (${backend.type})`),
      queries: config.queries.map((query) => `${query.name} [${query.signal}]`),
      scrubbers: config.redaction.scrubbers,
    };

    this.report(summary, cli.outputFormat);
  }

  private report(summary: ConfigSummary, format: OutputFormat): void {
    if (format !== OutputFormat.Text) {
      this.streams.write(`${JSON.stringify(summary)}\n`);
      return;
    }

    const lines = [
      `config:    ${summary.configPath}`,
      `backends:  ${summary.backends.join(', ')}`,
      `queries:   ${summary.queries.join(', ')}`,
      `scrubbers: ${summary.scrubbers.join(', ')}`,
    ];
    this.streams.write(`${lines.join('\n')}\n`);
  }
}
