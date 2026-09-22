import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from '@heimdall/llm';
import { ConfigLoader } from '@heimdall/telemetry';
import { ConfigCommand } from './commands/config/config.command';
import { VersionCommand } from './commands/version/version.command';
import { CliConfigService } from './config/cli-config.service';
import { ExitCodeContract } from './errors/exit-code-contract.provider';
import { Streams } from './presentation/streams';

/**
 * Composition root. Port-to-adapter bindings are decided here and nowhere else,
 * which is what lets `replay` swap real adapters for fixture-backed ones (by
 * overriding `LLM_PROVIDER`) without the engine knowing. See .docs/adr/0004.
 */
@Module({
  // forRoot() runs when this file is imported, so `.env` is in process.env
  // before any provider factory executes. Existing variables win over the file.
  imports: [ConfigModule.forRoot({ isGlobal: true }), LlmModule],
  providers: [
    Streams,
    ExitCodeContract,
    ConfigLoader,
    CliConfigService,
    ConfigCommand,
    VersionCommand,
  ],
})
export class CliModule {}
