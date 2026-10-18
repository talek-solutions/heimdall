import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffValues } from './json-diff';

describe('diffValues', () => {
  it('names each differing leaf by its path, up to a limit', () => {
    assert.deepEqual(
      diffValues(
        { templates: { new: [{ confirmedAbsent: null }, { count: 2 }] }, same: 1 },
        { templates: { new: [{ confirmedAbsent: true }] }, same: 1 },
        10,
      ),
      [
        { path: 'templates.new[0].confirmedAbsent', recorded: 'null', replayed: 'true' },
        { path: 'templates.new[1]', recorded: '{"count":2}', replayed: '(absent)' },
      ],
    );
    assert.equal(diffValues([1, 2, 3], [4, 5, 6], 2).length, 2);
    assert.deepEqual(diffValues({ a: [1] }, { a: [1] }, 10), []);
  });
});
