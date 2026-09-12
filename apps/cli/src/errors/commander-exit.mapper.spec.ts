import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';
import { exitCodeForCommanderError, isHelpRequest } from './commander-exit.mapper';

function commanderError(code: string, exitCode: number): Error {
  return Object.assign(new Error(code), { code, exitCode });
}

const unknownCommand = (): Error => commanderError('commander.unknownCommand', 1);

describe('isHelpRequest', () => {
  it('recognises the help subcommand', () => {
    assert.equal(isHelpRequest(['help', 'version']), true);
  });

  it('recognises long and short help flags anywhere in the args', () => {
    assert.equal(isHelpRequest(['version', '--help']), true);
    assert.equal(isHelpRequest(['version', '-h']), true);
  });

  it('does not treat an ordinary invocation as a help request', () => {
    assert.equal(isHelpRequest(['version']), false);
    assert.equal(isHelpRequest([]), false);
  });
});

describe('exitCodeForCommanderError', () => {
  it('maps an unknown command to Usage', () => {
    assert.equal(
      exitCodeForCommanderError(unknownCommand(), { args: ['bogus'] }),
      ExitCode.Usage,
    );
  });

  it('maps an unknown option to Usage', () => {
    assert.equal(
      exitCodeForCommanderError(commanderError('commander.unknownOption', 1), {
        args: ['version', '--nope'],
      }),
      ExitCode.Usage,
    );
  });

  it('treats an explicit zero exitCode as success', () => {
    assert.equal(
      exitCodeForCommanderError(commanderError('commander.helpDisplayed', 0), {
        args: ['--help'],
      }),
      ExitCode.Success,
    );
  });

  it('treats `help <command>` as success despite the unknownCommand code', () => {
    // commander 8 prints the right help, then raises unknownCommand anyway.
    assert.equal(
      exitCodeForCommanderError(unknownCommand(), { args: ['help', 'version'] }),
      ExitCode.Success,
    );
  });

  it('treats `<command> --help` as success despite the unknownCommand code', () => {
    assert.equal(
      exitCodeForCommanderError(unknownCommand(), { args: ['version', '--help'] }),
      ExitCode.Success,
    );
  });

  it('maps a non-commander error to Unexpected', () => {
    assert.equal(
      exitCodeForCommanderError(new Error('boom'), { args: ['rca'] }),
      ExitCode.Unexpected,
    );
  });
});
