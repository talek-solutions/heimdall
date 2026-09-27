import { hashInts } from '../engine/deterministic-random';

/** Where a trace comes from: enough to regenerate it exactly. */
export interface ITraceAddress {
  readonly template: number;
  /** Seconds from the start of the timeline; negative before it. */
  readonly bucket: number;
  readonly ordinal: number;
}

const WORD_HEX_DIGITS = 8;
const TRACE_ID_HEX_DIGITS = 32;
const HEX_RADIX = 16;
const FEISTEL_ROUNDS = 4;
const MAX_FIELD = 0xffff;
const HEX_ID = /^[0-9a-f]{1,32}$/;

type Words = readonly [number, number, number, number];

/**
 * Trace IDs are stateless: `(template, bucket, ordinal)` plus a tag of the
 * scenario content and a checksum, run through a keyed Feistel network so the
 * IDs look random (a shared prefix is something a model would latch onto).
 * Decoding a forged, altered or stale ID fails the checksum or the tag.
 */
export class TraceIdCodec {
  private readonly tag: number;
  private readonly key: number;

  constructor(seed: number, contentHash: string) {
    this.tag = Number.parseInt(contentHash.slice(0, WORD_HEX_DIGITS), HEX_RADIX) >>> 0;
    this.key = hashInts([seed, this.tag]);
  }

  public encode(address: ITraceAddress): string {
    if (address.template > MAX_FIELD || address.ordinal > MAX_FIELD) {
      throw new RangeError(`trace address out of range: ${JSON.stringify(address)}`);
    }
    const bucket = address.bucket >>> 0;
    const fields = ((address.template << 16) | address.ordinal) >>> 0;
    const plain: Words = [bucket, fields, this.tag, this.checksum(bucket, fields)];

    return this.scramble(plain)
      .map((word) => word.toString(HEX_RADIX).padStart(WORD_HEX_DIGITS, '0'))
      .join('');
  }

  /** `undefined` for anything this scenario did not issue. Accepts IDs with leading zeros dropped. */
  public decode(traceId: string): ITraceAddress | undefined {
    const hex = traceId.toLowerCase();

    if (!HEX_ID.test(hex)) {
      return undefined;
    }
    const padded = hex.padStart(TRACE_ID_HEX_DIGITS, '0');
    const scrambled = [0, 1, 2, 3].map((index) =>
      Number.parseInt(padded.slice(index * WORD_HEX_DIGITS, (index + 1) * WORD_HEX_DIGITS), HEX_RADIX),
    ) as unknown as Words;
    const [bucket, fields, tag, checksum] = this.unscramble(scrambled);

    if (tag !== this.tag || checksum !== this.checksum(bucket, fields)) {
      return undefined;
    }
    return { template: fields >>> 16, bucket: bucket | 0, ordinal: fields & MAX_FIELD };
  }

  private checksum(bucket: number, fields: number): number {
    return hashInts([this.key, bucket, fields, this.tag]);
  }

  private scramble(words: Words): Words {
    let [left0, left1, right0, right1] = words;

    for (let round = 0; round < FEISTEL_ROUNDS; round += 1) {
      const [mix0, mix1] = this.round(round, right0, right1);
      [left0, left1, right0, right1] = [right0, right1, (left0 ^ mix0) >>> 0, (left1 ^ mix1) >>> 0];
    }
    return [left0, left1, right0, right1];
  }

  private unscramble(words: Words): Words {
    let [left0, left1, right0, right1] = words;

    for (let round = FEISTEL_ROUNDS - 1; round >= 0; round -= 1) {
      const [mix0, mix1] = this.round(round, left0, left1);
      [left0, left1, right0, right1] = [(right0 ^ mix0) >>> 0, (right1 ^ mix1) >>> 0, left0, left1];
    }
    return [left0, left1, right0, right1];
  }

  private round(round: number, half0: number, half1: number): readonly [number, number] {
    return [hashInts([this.key, round, half0, half1, 0]), hashInts([this.key, round, half0, half1, 1])];
  }
}
