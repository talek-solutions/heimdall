import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { isAtomicTemporary, writeFileAtomic } from './atomic-write';

const root = mkdtempSync(path.join(os.tmpdir(), 'heimdall-atomic-'));
const PRIVATE = 0o600;

describe('writeFileAtomic (ADR 0019, Atomic writes)', () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it('writes the whole file with the mode asked for, and leaves nothing else behind', () => {
    const file = path.join(root, 'scorecard.json');

    writeFileAtomic(file, '{"runs":[]}\n', { mode: PRIVATE });

    assert.equal(readFileSync(file, 'utf8'), '{"runs":[]}\n');
    assert.equal(statSync(file).mode & 0o777, PRIVATE);
    assert.deepEqual(readdirSync(root), ['scorecard.json']);
  });

  it('replaces a file that is already there', () => {
    const file = path.join(root, 'replaced.json');

    writeFileSync(file, 'old');
    writeFileAtomic(file, 'new');

    assert.equal(readFileSync(file, 'utf8'), 'new');
  });

  it('removes its temporary file and keeps the old content when the write fails', () => {
    const directory = mkdtempSync(path.join(root, 'failing-'));
    const target = path.join(directory, 'kept.json');

    // A directory cannot be renamed over: the rename fails after the temporary file is written.
    mkdtempSync(path.join(directory, 'blocker-'));
    const blocked = path.join(directory, readdirSync(directory)[0] ?? '');
    writeFileSync(path.join(blocked, 'inside'), 'x');
    writeFileSync(target, 'old');

    assert.throws(() => writeFileAtomic(blocked, 'new'));
    assert.equal(readFileSync(target, 'utf8'), 'old');
    assert.deepEqual(readdirSync(directory).filter(isAtomicTemporary), []);
  });

  it('fails without a temporary file when the directory does not exist', () => {
    assert.throws(() => writeFileAtomic(path.join(root, 'missing', 'file.json'), 'x'));
    assert.deepEqual(readdirSync(root).filter(isAtomicTemporary), []);
  });

  it('names its temporary files so that no reader takes one for a real file', () => {
    assert.equal(isAtomicTemporary('.2026-10-18T09-12-04-311Z-3fa2c1.json.0a1b2c.tmp'), true);
    assert.equal(isAtomicTemporary('.error-burst-30s-1.score.yaml.ffffff.tmp'), true);
    assert.equal(isAtomicTemporary('2026-10-18T09-12-04-311Z-3fa2c1.json'), false);
    assert.equal(isAtomicTemporary('scorecard.json'), false);
    assert.equal(isAtomicTemporary('notes.tmp'), false);
  });
});
