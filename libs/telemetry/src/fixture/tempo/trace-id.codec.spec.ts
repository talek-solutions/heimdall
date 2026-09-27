import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TraceIdCodec } from './trace-id.codec';

const HASH = 'a1b2c3d4'.repeat(8);

describe('TraceIdCodec', () => {
  const codec = new TraceIdCodec(42, HASH);

  it('round-trips addresses, including buckets before the timeline', () => {
    for (const address of [
      { template: 0, bucket: 0, ordinal: 0 },
      { template: 3, bucket: 172_799, ordinal: 11 },
      { template: 65_535, bucket: -86_400, ordinal: 65_535 },
    ]) {
      const traceId = codec.encode(address);
      assert.match(traceId, /^[0-9a-f]{32}$/);
      assert.deepEqual(codec.decode(traceId), address);
    }
  });

  it('produces IDs without a shared prefix', () => {
    const prefixes = new Set(
      Array.from({ length: 50 }, (_, ordinal) => codec.encode({ template: 0, bucket: 100, ordinal }).slice(0, 4)),
    );
    assert.ok(prefixes.size > 40);
  });

  it('rejects forged, altered and stale IDs', () => {
    const traceId = codec.encode({ template: 1, bucket: 5, ordinal: 2 });
    const altered = `${traceId.slice(0, 31)}${traceId.endsWith('0') ? '1' : '0'}`;

    assert.equal(codec.decode(altered), undefined);
    assert.equal(codec.decode('0af7651916cd43dd8448eb211c80319c'), undefined);
    assert.equal(codec.decode('not-hex'), undefined);
    assert.equal(new TraceIdCodec(42, 'ffffffff'.repeat(8)).decode(traceId), undefined);
    assert.equal(new TraceIdCodec(43, HASH).decode(traceId), undefined);
  });

  it('accepts upper case and dropped leading zeros', () => {
    const traceId = Array.from({ length: 5_000 }, (_, ordinal) => codec.encode({ template: 0, bucket: 1, ordinal })).find(
      (candidate) => candidate.startsWith('0'),
    );
    assert.ok(traceId !== undefined);
    assert.deepEqual(codec.decode(traceId.replace(/^0+/, '').toUpperCase()), codec.decode(traceId));
  });
});
