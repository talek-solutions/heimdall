import { Module } from '@nestjs/common';
import { ConfigLoader } from '@heimdall/telemetry';
import { ConfigCommand } from './commands/config/config.command';
import { VersionCommand } from './commands/version/version.command';
import { CliConfigService } from './config/cli-config.service';
import { ExitCodeContract } from './errors/exit-code-contract.provider';
import { Streams } from './presentation/streams';

/**
 * Composition root. Port-to-adapter bindings live here and nowhere else, which is
 * what lets `replay` swap real adapters for fixture-backed ones without the engine
 * knowing. See .docs/adr/0004.
 */
@Module({
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
