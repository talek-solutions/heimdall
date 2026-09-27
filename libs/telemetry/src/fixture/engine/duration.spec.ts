import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDuration } from './duration';

describe('parseDuration', () => {
  it('reads single and compound Prometheus-style durations', () => {
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('1h30m'), 5_400_000);
    assert.equal(parseDuration('2d'), 172_800_000);
    assert.equal(parseDuration('1w'), 604_800_000);
    assert.equal(parseDuration('0s'), 0);
  });

  it('reads `ms` as milliseconds, not minutes', () => {
    assert.equal(parseDuration('250ms'), 250);
    assert.equal(parseDuration('1m500ms'), 60_500);
  });

  it('rejects anything else', () => {
    for (const value of ['', '30', '1.5h', '-5m', '5 m', '5x', 'h']) {
      assert.equal(parseDuration(value), undefined, value);
    }
  });
});
