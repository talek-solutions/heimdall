import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectCommander } from 'nest-commander';
import type { Command } from 'commander';
import { ExitCode } from '@heimdall/core';
import { exitCodeForCommanderError } from './commander-exit.mapper';

/**
 * Owns the exit-code contract from .docs/adr/0006 across the whole command tree.
 *
 * Two nest-commander behaviours make this necessary:
 *
 * 1. It applies commander's `exitOverride` to the ROOT command only, so a usage
 *    error on a subcommand (`heimdall version --nope`) would otherwise never reach
 *    our handler — commander calls `process.exit(1)` itself.
 * 2. During `run()` it *overwrites* the root `exitOverride` with the `errorHandler`
 *    passed to `CommandFactory`. So the root path cannot be owned from here; the
 *    entry point closes its handler over `resolve()` instead.
 */
@Injectable()
export class ExitCodeContract implements OnApplicationBootstrap {
  constructor(@InjectCommander() private readonly program: Command) {}

  onApplicationBootstrap(): void {
    this.applyTo(this.program);
  }

  /** Maps a commander failure to an exit code, with command-registry context. */
  resolve(error: Error): ExitCode {
    return exitCodeForCommanderError(error);
  }

  private applyTo(command: Command): void {
    command.exitOverride((error): never => {
      // commander has already written its diagnostic to stderr synchronously, so
      // exiting here loses nothing and is what makes the code stick.
      process.exit(this.resolve(error));
    });

    for (const subcommand of command.commands) {
      this.applyTo(subcommand as Command);
    }
  }

}
