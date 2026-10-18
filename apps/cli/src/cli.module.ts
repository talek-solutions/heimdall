import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from '@heimdall/agent';
import { LlmModule } from '@heimdall/llm';
import { HeimdallConfigModule } from '@heimdall/config';
import { ManifestModule } from '@heimdall/core/manifest';
import { EvalsModule } from '@heimdall/evals';
import { InvestigationModule } from '@heimdall/investigation';
import { TelemetryDatasourceConfigModule } from '@heimdall/telemetry';
import { TranscriptModule } from '@heimdall/transcript';
import { ConfigCommand } from './commands/config/config.command';
import { EvalCommand } from './commands/eval/eval.command';
import { InvestigateCommand } from './commands/investigate/investigate.command';
import { ReplayCommand } from './commands/replay/replay.command';
import { VersionCommand } from './commands/version/version.command';
import { CliConfigService } from './config/cli-config.service';
import { ExitCodeContract } from './errors/exit-code-contract.provider';
import { FixtureModeNotice } from './presentation/fixture-mode.notice';
import { Streams } from './presentation/streams';

/**
 * Composition root. Port-to-adapter bindings are decided here and nowhere else,
 * which is what lets `replay` answer the model and the sources from a transcript
 * (the `TranscriptModule` interceptors) without the engine knowing. See .docs/adr/0004
 * and 0007.
 */
@Module({
  // forRoot() runs when this file is imported, so `.env` is in process.env
  // before any provider factory executes. Existing variables win over the file.
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LlmModule,
    AgentModule,
    HeimdallConfigModule,
    TelemetryDatasourceConfigModule,
    // Global: its session wraps the model and the redacting sources for record and replay.
    TranscriptModule,
    ManifestModule,
    InvestigationModule,
    EvalsModule,
  ],
  providers: [
    Streams,
    ExitCodeContract,
    FixtureModeNotice,
    CliConfigService,
    ConfigCommand,
    EvalCommand,
    InvestigateCommand,
    ReplayCommand,
    VersionCommand,
  ],
})
export class CliModule {}
