import { Inject } from '@nestjs/common';
import { Command, Option } from 'nest-commander';
import { OutputFormat } from '@heimdall/core';
import {
  HEIMDALL_CONFIG,
  HEIMDALL_CONFIG_PATH,
  resolveActiveContext,
  type IHeimdallConfig,
  type ISourceConfig,
} from '@heimdall/config';
import { TelemetryBackend } from '@heimdall/telemetry';
import { CliConfigService } from '../../config/cli-config.service';
import type { CliFlags } from '../../config/cli-config.model';
import { Streams } from '../../presentation/streams';
import { HeimdallCommand } from '../heimdall.command';

interface ConfigCommandFlags extends CliFlags {
  readonly context?: string;
}

interface ContextSummary {
  readonly name: string;
  readonly sources: readonly string[];
}

interface ConfigSummary {
  readonly configPath: string;
  readonly sources: readonly string[];
  readonly contexts: readonly string[];
  readonly context: ContextSummary | null;
  readonly scrubbers: readonly string[];
}

const NONE = '(none)';

@Command({
  name: 'config',
  description: 'Validate the Heimdall configuration and summarise it',
})
export class ConfigCommand extends HeimdallCommand {
  constructor(
    streams: Streams,
    private readonly configService: CliConfigService,
    @Inject(HEIMDALL_CONFIG) private readonly config: IHeimdallConfig,
    @Inject(HEIMDALL_CONFIG_PATH) private readonly configPath: string,
  ) {
    super(streams);
  }

  @Option({
    flags: '--context <name>',
    description: 'Context to summarise (default: $HEIMDALL_CONTEXT, then currentContext)',
  })
  parseContext(value: string): string {
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
    const flags = options as ConfigCommandFlags;
    const cli = this.configService.resolve(flags);
    const active = resolveActiveContext(this.config, { flag: flags.context, env: process.env });

    const summary: ConfigSummary = {
      configPath: this.configPath,
      sources: this.config.sources.map((source) => this.describeSource(source)),
      contexts: this.config.contexts.map((context) => context.name),
      context:
        active === undefined
          ? null
          : { name: active.name, sources: active.sources.map((source) => source.alias) },
      scrubbers: this.config.redaction.scrubbers,
    };

    this.report(summary, cli.outputFormat);
  }

  private describeSource(source: ISourceConfig): string {
    return source.type === TelemetryBackend.Grafana
      ? `${source.alias} (${source.type}:${source.signal})`
      : `${source.alias} (${source.type})`;
  }

  private report(summary: ConfigSummary, format: OutputFormat): void {
    if (format !== OutputFormat.Text) {
      this.streams.write(`${JSON.stringify(summary)}\n`);
      return;
    }

    const context =
      summary.context === null
        ? NONE
        : `${summary.context.name} -> ${summary.context.sources.join(', ')}`;
    const lines = [
      `config:    ${summary.configPath}`,
      `sources:   ${this.list(summary.sources)}`,
      `contexts:  ${this.list(summary.contexts)}`,
      `context:   ${context}`,
      `scrubbers: ${this.list(summary.scrubbers)}`,
    ];
    this.streams.write(`${lines.join('\n')}\n`);
  }

  private list(items: readonly string[]): string {
    return items.length === 0 ? NONE : items.join(', ');
  }
}
