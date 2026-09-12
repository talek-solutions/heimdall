import { ExitCode } from '@heimdall/core';

/**
 * Translates a commander failure into the exit-code contract in
 * .docs/adr/0006-cli-output-contract.md.
 *
 * Commander routes only *failures* through this path — a plain `--help` succeeds
 * and exits 0 without raising. An error arriving here is therefore a malformed
 * invocation unless it says otherwise.
 *
 * The awkward part is commander 8's help handling. `heimdall help <command>` and
 * `heimdall <command> --help` both print the correct help and *then* raise
 * `commander.unknownCommand` with `exitCode: 1` — the same shape a genuine typo
 * produces. The error carries nothing that separates them, so the invocation is
 * inspected instead: an explicit help request exits 0.
 *
 * Known deviation: `heimdall help <unknown>` also exits 0 under this rule. It
 * prints root help, which is a reasonable response to the request, and getting it
 * "right" would require distinguishing registered commands — which is not reliably
 * available on this code path. Recorded rather than hidden.
 */
export interface CommanderExitContext {
  /** The invocation's arguments, excluding argv[0] and argv[1]. */
  readonly args: readonly string[];
}

interface CommanderErrorLike {
  readonly code?: string;
  readonly exitCode?: number;
}

const COMMANDER_CODE_PREFIX = 'commander.';
const HELP_COMMAND = 'help';
const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h']);

export function isHelpRequest(args: readonly string[]): boolean {
  return args[0] === HELP_COMMAND || args.some((arg) => HELP_FLAGS.has(arg));
}

export function exitCodeForCommanderError(
  error: Error,
  context: CommanderExitContext = { args: process.argv.slice(2) },
): ExitCode {
  const { code, exitCode } = error as CommanderErrorLike;

  if (exitCode === 0 || isHelpRequest(context.args)) {
    return ExitCode.Success;
  }
  if (code?.startsWith(COMMANDER_CODE_PREFIX) === true) {
    return ExitCode.Usage;
  }
  return ExitCode.Unexpected;
}
