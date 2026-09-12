import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ExitCode } from '@heimdall/core';

const ENTRY = path.join(__dirname, '..', 'heimdall.js');

interface Invocation {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function invoke(...args: string[]): Invocation {
  try {
    const stdout = execFileSync(process.execPath, [ENTRY, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('exit-code contract (end to end)', () => {
  it('exits Success for a successful command', () => {
    assert.equal(invoke('version').status, ExitCode.Success);
  });

  it('exits Success for help and version flags', () => {
    assert.equal(invoke('--help').status, ExitCode.Success);
    assert.equal(invoke('--version').status, ExitCode.Success);
    assert.equal(invoke('help').status, ExitCode.Success);
  });

  it('exits Success for per-command help in both spellings', () => {
    // Both print correct help but commander raises unknownCommand underneath.
    assert.equal(invoke('help', 'version').status, ExitCode.Success);
    assert.equal(invoke('version', '--help').status, ExitCode.Success);
  });

  it('exits Usage for an unknown command', () => {
    assert.equal(invoke('bogus').status, ExitCode.Usage);
  });

  it('exits Usage for an unknown option, including on a subcommand', () => {
    // The subcommand case is the one nest-commander leaves at commander's
    // default exit(1); ExitCodeContract is what brings it back to the contract.
    assert.equal(invoke('--nope').status, ExitCode.Usage);
    assert.equal(invoke('version', '--nope').status, ExitCode.Usage);
  });
});

describe('stdout discipline', () => {
  it('puts only data on stdout', () => {
    const { stdout } = invoke('version');
    assert.equal(stdout, '0.0.0\n');
  });

  it('keeps diagnostics off stdout when the invocation fails', () => {
    const { stdout, stderr } = invoke('bogus');
    assert.equal(stdout, '');
    assert.match(stderr, /unknown command/);
  });
});
