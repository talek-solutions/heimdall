import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { argvRequestsMachineOutput } from './machine-output';

describe('argvRequestsMachineOutput', () => {
  it('detects --json and --ndjson anywhere in argv', () => {
    assert.equal(argvRequestsMachineOutput(['config', '--json']), true);
    assert.equal(argvRequestsMachineOutput(['--ndjson', 'config']), true);
  });

  it('detects --output in both spellings', () => {
    assert.equal(argvRequestsMachineOutput(['config', '--output', 'json']), true);
    assert.equal(argvRequestsMachineOutput(['config', '--output=ndjson']), true);
  });

  it('ignores text output and unrelated flags', () => {
    assert.equal(argvRequestsMachineOutput(['config', '--output', 'text']), false);
    assert.equal(argvRequestsMachineOutput(['config', '--context', 'json']), false);
    assert.equal(argvRequestsMachineOutput(['config', '--output']), false);
  });
});
