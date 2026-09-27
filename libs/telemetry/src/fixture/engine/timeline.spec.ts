import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Timeline } from './timeline';

describe('Timeline', () => {
  const timeline = new Timeline(new Date('2026-09-25T08:00:00Z'), 2 * 3_600_000);

  it('ends at the anchor and starts one duration before it', () => {
    assert.equal(new Date(timeline.startMs).toISOString(), '2026-09-25T06:00:00.000Z');
    assert.equal(timeline.relative(Date.parse('2026-09-25T07:30:00Z')), 90 * 60_000);
    assert.equal(timeline.relative(Date.parse('2026-09-25T05:00:00Z')), -3_600_000);
  });

  it('has data up to and including the anchor, never after it', () => {
    assert.equal(timeline.hasData(timeline.anchorMs), true);
    assert.equal(timeline.hasData(timeline.anchorMs + 1), false);
    assert.equal(timeline.hasData(timeline.startMs - 3_600_000), true);
  });
});
