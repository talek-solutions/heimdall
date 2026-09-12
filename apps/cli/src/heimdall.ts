#!/usr/bin/env node
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { ExitCode } from '@heimdall/core';
import { CliModule } from './cli.module';
import { ExitCodeContract } from './errors/exit-code-contract.provider';
import { writeDiagnostic } from './presentation/streams';
import { version } from './version';

async function bootstrap(): Promise<void> {
  // nest-commander overwrites the root command's exitOverride with this handler
  // during run(), so the root path must be handled here rather than in the
  // provider. The app is built first so the handler can close over the fully
  // constructed ExitCodeContract, which knows the registered command list.
  let contract: ExitCodeContract | undefined;

  const app = await CommandFactory.createWithoutRunning(CliModule, {
    cliName: 'heimdall',
    version,
    // Nest's bootstrap logger writes to stdout, which would corrupt `--json`.
    // Diagnostics go through Streams (stderr) instead. See .docs/adr/0006.
    logger: false,
    errorHandler: (error: Error): void => {
      process.exit(contract?.resolve(error) ?? ExitCode.Unexpected);
    },
  });

  contract = app.get(ExitCodeContract);

  await CommandFactory.runApplication(app);
  await app.close();
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  writeDiagnostic(`heimdall: ${message}\n`);
  process.exitCode = ExitCode.Unexpected;
});
