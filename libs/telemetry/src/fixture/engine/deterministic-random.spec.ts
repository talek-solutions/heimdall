import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeterministicRandom, hashInts, hashString } from './deterministic-random';

const SAMPLES = 20_000;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe('DeterministicRandom', () => {
  it('replays the same sequence for the same seed', () => {
    const first = new DeterministicRandom(42);
    const second = new DeterministicRandom(42);

    for (let index = 0; index < 100; index += 1) {
      assert.equal(first.next(), second.next());
    }
  });

  it('hashes are stable and order-sensitive', () => {
    assert.equal(hashString('checkout'), hashString('checkout'));
    assert.notEqual(hashString('checkout'), hashString('payments'));
    assert.equal(hashInts([1, 2, 3]), hashInts([1, 2, 3]));
    assert.notEqual(hashInts([1, 2, 3]), hashInts([3, 2, 1]));
    assert.notEqual(hashInts([7, -1]), hashInts([7, 1]));
  });

  it('draws uniforms in [0, 1) and gaussians around 0 with unit spread', () => {
    const random = new DeterministicRandom(9);
    const uniforms = Array.from({ length: SAMPLES }, () => random.next());
    const gaussians = Array.from({ length: SAMPLES }, () => random.gaussian());
    const variance = mean(gaussians.map((value) => value * value));

    assert.ok(uniforms.every((value) => value >= 0 && value < 1));
    assert.ok(Math.abs(mean(uniforms) - 0.5) < 0.01);
    assert.ok(Math.abs(mean(gaussians)) < 0.03);
    assert.ok(Math.abs(variance - 1) < 0.05);
  });

  it('draws Poisson counts with the requested mean, small and large', () => {
    const random = new DeterministicRandom(11);

    for (const expected of [0.5, 4, 250]) {
      const counts = Array.from({ length: SAMPLES }, () => random.poisson(expected));
      assert.ok(counts.every((count) => Number.isInteger(count) && count >= 0));
      assert.ok(Math.abs(mean(counts) - expected) < expected * 0.03 + 0.02, `mean ${expected}`);
    }
    assert.equal(random.poisson(0), 0);
  });

  it('picks indexes in proportion to their weights, never a zero weight', () => {
    const random = new DeterministicRandom(5);
    const picks = Array.from({ length: SAMPLES }, () => random.weightedIndex([3, 0, 1]));
    const share = picks.filter((index) => index === 0).length / SAMPLES;

    assert.ok(!picks.includes(1));
    assert.ok(Math.abs(share - 0.75) < 0.02);
    assert.equal(random.weightedIndex([0, 0]), undefined);
  });

  it('draws inclusive integers', () => {
    const random = new DeterministicRandom(3);
    const values = new Set(Array.from({ length: 1_000 }, () => random.integer(2, 4)));

    assert.deepEqual([...values].sort(), [2, 3, 4]);
  });
});
