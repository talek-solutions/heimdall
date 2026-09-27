import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { heimdallHomeDir } from './heimdall-home';

describe('heimdallHomeDir', () => {
  it('is ~/.heimdall', () => {
    assert.equal(heimdallHomeDir('/Users/someone'), '/Users/someone/.heimdall');
  });
});
