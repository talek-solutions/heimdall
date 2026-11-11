import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { resolveBuildIdentity } from './build-identity';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'heimdall-build-')));
const VERSION = '0.0.0';
const COMMIT = /^[0-9a-f]{40}$/;
const IDENTITY = ['-c', 'user.name=spec', '-c', 'user.email=spec@example.invalid'];

function git(directory: string, ...args: string[]): string {
  return execFileSync('git', ['-C', directory, ...IDENTITY, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** A checkout with one commit, and a nested directory standing in for `apps/cli/dist`. */
function checkout(name: string): { directory: string; entry: string; head: string } {
  const directory = path.join(root, name);
  const entry = path.join(directory, 'apps', 'cli', 'dist');

  mkdirSync(entry, { recursive: true });
  git(directory, 'init', '--quiet');
  writeFileSync(path.join(directory, 'tracked.ts'), 'export const a = 1;\n');
  git(directory, 'add', 'tracked.ts');
  git(directory, 'commit', '--quiet', '--no-gpg-sign', '-m', 'first');
  return { directory, entry, head: git(directory, 'rev-parse', 'HEAD') };
}

describe('resolveBuildIdentity (ADR 0022)', () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it('names the commit of the checkout the code is in, whatever the working directory', () => {
    const { entry, head } = checkout('clean');
    const elsewhere = mkdtempSync(path.join(root, 'cwd-'));
    const previous = process.cwd();

    process.chdir(elsewhere);
    try {
      assert.deepEqual(resolveBuildIdentity(VERSION, entry), {
        version: VERSION,
        commit: head,
        dirty: false,
      });
      assert.match(head, COMMIT);
    } finally {
      process.chdir(previous);
    }
  });

  it('says so when a tracked file has an uncommitted change, and ignores untracked files', () => {
    const { directory, entry, head } = checkout('dirty');

    writeFileSync(path.join(directory, 'untracked.txt'), 'new');
    assert.equal(resolveBuildIdentity(VERSION, entry).dirty, false);

    writeFileSync(path.join(directory, 'tracked.ts'), 'export const a = 2;\n');
    assert.deepEqual(resolveBuildIdentity(VERSION, entry), {
      version: VERSION,
      commit: head,
      dirty: true,
    });
  });

  it('follows a git worktree to its own commit', () => {
    const { directory } = checkout('main');
    const worktree = path.join(root, 'worktree');

    git(directory, 'worktree', 'add', '--quiet', '-b', 'side', worktree);
    writeFileSync(path.join(worktree, 'side.ts'), 'export const b = 1;\n');
    git(worktree, 'add', 'side.ts');
    git(worktree, 'commit', '--quiet', '--no-gpg-sign', '-m', 'second');

    assert.equal(resolveBuildIdentity(VERSION, worktree).commit, git(worktree, 'rev-parse', 'HEAD'));
    assert.notEqual(
      resolveBuildIdentity(VERSION, worktree).commit,
      resolveBuildIdentity(VERSION, directory).commit,
    );
  });

  it('has no commit outside a checkout, and never throws', () => {
    const outside = mkdtempSync(path.join(root, 'outside-'));
    const unknown = { version: VERSION, commit: null, dirty: false };

    assert.deepEqual(resolveBuildIdentity(VERSION, outside), unknown);
    assert.deepEqual(resolveBuildIdentity(VERSION, path.join(root, 'no-such-directory')), unknown);
  });

  it('has no commit when installed as a dependency of somebody else’s checkout', () => {
    const { directory } = checkout('host');
    const installed = path.join(directory, 'node_modules', 'heimdall', 'apps', 'cli', 'dist');

    mkdirSync(installed, { recursive: true });

    assert.equal(resolveBuildIdentity(VERSION, installed).commit, null);
  });

  it('has no commit when git cannot be run', () => {
    const { entry } = checkout('no-git');
    const previous = process.env['PATH'];

    process.env['PATH'] = '';
    try {
      assert.equal(resolveBuildIdentity(VERSION, entry).commit, null);
    } finally {
      process.env['PATH'] = previous;
    }
  });
});
