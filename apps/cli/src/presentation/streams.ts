import { Injectable } from '@nestjs/common';

/**
 * The ONLY module permitted to write to stdout or stderr.
 *
 * stdout carries data and nothing else, so `heimdall rca --json | jq` works without
 * qualification. Progress, logs, errors and the banner all go to stderr. A guard
 * test (`streams.guard.spec.ts`) fails the build if any other source file touches
 * `console.*`, `process.stdout` or `process.stderr`.
 *
 * The raw functions exist for the bootstrap path, which must report a failure
 * before the DI container is available. Everything else injects `Streams`.
 *
 * See .docs/adr/0006-cli-output-contract.md
 */
export function writeData(text: string): void {
  process.stdout.write(text);
}

export function writeDiagnostic(text: string): void {
  process.stderr.write(text);
}

export function stdoutIsTty(): boolean {
  return process.stdout.isTTY === true;
}

export function stdinIsTty(): boolean {
  return process.stdin.isTTY === true;
}

@Injectable()
export class Streams {
  /** Machine-consumable output. Never progress, never decoration. */
  write(text: string): void {
    writeData(text);
  }

  /** Progress, diagnostics, errors, banner — everything a pipe should not see. */
  writeDiagnostic(text: string): void {
    writeDiagnostic(text);
  }

  /** True when stdout is a terminal, i.e. output is not piped or redirected. */
  isInteractive(): boolean {
    return stdoutIsTty();
  }

  /** True when stdin is a terminal. Prompting is forbidden when this is false. */
  canPrompt(): boolean {
    return stdinIsTty();
  }
}
