import { CommandRunner } from 'nest-commander';
import { OutputFormat } from '@heimdall/core';
import { exitCodeForError, toErrorResponse } from '../errors/error-exit.mapper';
import type { Streams } from '../presentation/streams';

/**
 * Base for every Heimdall command.
 *
 * Nest's exception filters bind to HTTP controllers and never see a
 * `CommandRunner`, so this is the CLI's equivalent: one place that turns a thrown
 * error into the `{errorCode, message?}` response shape and the exit code from
 * .docs/adr/0006. Subclasses implement `execute` and simply throw.
 *
 * The failure is written to stderr as text, or to stdout as JSON when a machine
 * format was requested — a caller parsing `--json` needs the error in the same
 * channel and shape as a success, not prose on a stream it isn't reading.
 */
export abstract class HeimdallCommand extends CommandRunner {
  protected constructor(protected readonly streams: Streams) {
    super();
  }

  override async run(
    passedParams: string[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.execute(passedParams, options ?? {});
    } catch (error) {
      this.fail(error, options ?? {});
    }
  }

  protected abstract execute(
    passedParams: string[],
    options: Record<string, unknown>,
  ): Promise<void>;

  private fail(error: unknown, options: Record<string, unknown>): never {
    const response = toErrorResponse(error);

    if (this.wantsMachineOutput(options)) {
      this.streams.write(`${JSON.stringify(response)}\n`);
    } else {
      const detail = response.message === undefined ? '' : `: ${response.message}`;
      this.streams.writeDiagnostic(`heimdall: ${response.errorCode}${detail}\n`);
    }
    process.exit(exitCodeForError(error));
  }

  /**
   * Read from raw options rather than resolved config: the failure may BE the
   * config resolution, in which case no resolved config exists to consult.
   */
  private wantsMachineOutput(options: Record<string, unknown>): boolean {
    return (
      options['json'] === true ||
      options['ndjson'] === true ||
      options['output'] === OutputFormat.Json ||
      options['output'] === OutputFormat.Ndjson
    );
  }
}

