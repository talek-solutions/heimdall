#!/usr/bin/env node
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { ExitCode } from '@heimdall/core';
import { CliModule } from './cli.module';
import { ExitCodeContract } from './errors/exit-code-contract.provider';
import { exitCodeForError, toErrorResponse } from './errors/error-exit.mapper';
import { argvRequestsMachineOutput } from './errors/machine-output';
import { shutdownTracing, startTracing } from './observability/tracing';
import { writeData, writeDiagnostic } from './presentation/streams';
import { version } from './version';

async function bootstrap(): Promise<void> {
  // Before the app is built, so every span created while it runs reaches the SDK (ADR 0017).
  startTracing(process.env, version);

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
    // The default (true) exits 1 on a throwing factory, bypassing the exit-code contract.
    abortOnError: false,
    errorHandler: (error: Error): void => {
      process.exit(contract?.resolve(error) ?? ExitCode.Unexpected);
    },
  });

  contract = app.get(ExitCodeContract);

  await CommandFactory.runApplication(app);
  await app.close();
  await shutdownTracing();
}

// A provider threw at bootstrap, so HeimdallCommand never ran; apply its output contract here.
void bootstrap().catch(async (error: unknown) => {
  await shutdownTracing();
  const response = toErrorResponse(error);

  if (argvRequestsMachineOutput(process.argv.slice(2))) {
    writeData(`${JSON.stringify(response)}\n`);
  } else {
    const detail = response.message === undefined ? '' : `: ${response.message}`;
    writeDiagnostic(`heimdall: ${response.errorCode}${detail}\n`);
  }
  process.exitCode = exitCodeForError(error);
});
