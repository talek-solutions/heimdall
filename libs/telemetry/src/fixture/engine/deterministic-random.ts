const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const GOLDEN_RATIO = 0x9e3779b9;
const UINT32_RANGE = 4_294_967_296;
/** Above this mean, Knuth's product method gets slow and a normal approximation is indistinguishable. */
const POISSON_NORMAL_THRESHOLD = 30;

/** FNV-1a: turns ids into stable seeds. */
export function hashString(value: string): number {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** Order-sensitive hash of int32 values (larger values wrap), e.g. `[seed, seriesKey, bucket]`. */
export function hashInts(values: readonly number[]): number {
  let hash = GOLDEN_RATIO;

  for (const value of values) {
    hash = finalize((Math.imul(hash ^ (value | 0), 0x27d4eb2d) + 0x165667b1) | 0);
  }
  return hash;
}

/**
 * mulberry32. Seeded from a hash of *what* is being generated rather than from a
 * shared stream, so a value never depends on what else a query asked for.
 */
export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  static of(parts: readonly number[]): DeterministicRandom {
    return new DeterministicRandom(hashInts(parts));
  }

  /** Uniform in [0, 1). */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  /** Standard normal (Box-Muller). */
  public gaussian(): number {
    const radius = Math.sqrt(-2 * Math.log(1 - this.next()));
    return radius * Math.cos(2 * Math.PI * this.next());
  }

  /** Uniform integer in [min, max]. */
  public integer(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  public poisson(mean: number): number {
    if (mean <= 0) {
      return 0;
    }
    if (mean >= POISSON_NORMAL_THRESHOLD) {
      return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.gaussian()));
    }
    const limit = Math.exp(-mean);
    let count = 0;
    let product = this.next();

    while (product > limit) {
      count += 1;
      product *= this.next();
    }
    return count;
  }

  /** Index drawn in proportion to `weights`; `undefined` when every weight is zero. */
  public weightedIndex(weights: readonly number[]): number | undefined {
    const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);

    if (total <= 0) {
      return undefined;
    }
    let remaining = this.next() * total;

    for (const [index, weight] of weights.entries()) {
      remaining -= Math.max(0, weight);
      if (remaining < 0) {
        return index;
      }
    }
    return weights.length - 1;
  }
}

function finalize(input: number): number {
  let hash = input;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
