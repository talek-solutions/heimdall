import { LokiDirection } from '../../connectors/loki/loki.enums';
import { DeterministicRandom } from '../engine/deterministic-random';
import type { Timeline } from '../engine/timeline';
import { LOKI_MAX_SCANNED_LINES } from '../fixture-backend.constants';
import type { ILogStream } from '../scenario/scenario.model';
import { renderTemplate, type ITraceIdSource } from './log-template';
import type { LinePredicate } from './logql-query';

export interface ILogEntry {
  readonly stream: ILogStream;
  readonly timestampNs: bigint;
  readonly ordinal: number;
  readonly line: string;
}

export interface ILogWindow {
  /** Inclusive bounds, in nanoseconds. */
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly direction: LokiDirection;
  readonly limit: number;
  readonly accept: LinePredicate;
}

const BUCKET_MS = 1_000;
const NANOS_PER_MILLI = 1_000_000n;
const MAX_OFFSET_NS = 999_999_999;

/**
 * Lines are generated one whole second at a time from a PRNG seeded by
 * (scenario, stream, second): whether a line exists never depends on the query
 * window, so overlapping queries agree line for line. Seconds are walked from the
 * end the direction starts at, so `limit` bounds the work, not the window.
 */
export class LogLineGenerator {
  constructor(
    private readonly seed: number,
    private readonly timeline: Timeline,
    private readonly traces: ITraceIdSource | undefined,
  ) {}

  public collect(streams: readonly ILogStream[], window: ILogWindow): ILogEntry[] {
    const endNs = min(window.endNs, BigInt(this.timeline.anchorMs) * NANOS_PER_MILLI);

    if (streams.length === 0 || endNs < window.startNs) {
      return [];
    }
    const firstBucket = this.bucketOf(window.startNs);
    const lastBucket = this.bucketOf(endNs);
    const forward = window.direction === LokiDirection.Forward;
    const collected: ILogEntry[] = [];
    let scanned = 0;

    for (let offset = 0; offset <= lastBucket - firstBucket; offset += 1) {
      const bucket = forward ? firstBucket + offset : lastBucket - offset;
      const generated = streams.flatMap((stream) => this.bucketEntries(stream, bucket));
      scanned += generated.length;

      const kept = generated
        .filter(
          (entry) =>
            entry.timestampNs >= window.startNs && entry.timestampNs <= endNs && window.accept(entry.line),
        )
        .sort(forward ? compareEntries : (left, right) => compareEntries(right, left));
      collected.push(...kept);

      if (collected.length >= window.limit || scanned >= LOKI_MAX_SCANNED_LINES) {
        break;
      }
    }
    return collected.slice(0, window.limit);
  }

  private bucketOf(timestampNs: bigint): number {
    const relativeMs = this.timeline.relative(Number(timestampNs / NANOS_PER_MILLI));
    return Math.floor(relativeMs / BUCKET_MS);
  }

  private bucketEntries(stream: ILogStream, bucket: number): ILogEntry[] {
    const random = DeterministicRandom.of([this.seed, stream.key, bucket]);
    const relativeMs = bucket * BUCKET_MS;
    const perSecond = Math.max(0, stream.rate.valueAt(relativeMs));
    const count = random.poisson((perSecond * BUCKET_MS) / 1_000);
    const weights = stream.templates.map((template) => template.weight.valueAt(relativeMs));
    const bucketStartNs = BigInt(this.timeline.startMs + relativeMs) * NANOS_PER_MILLI;
    const entries: ILogEntry[] = [];

    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const offsetNs = random.integer(0, MAX_OFFSET_NS);
      const template = stream.templates[random.weightedIndex(weights) ?? -1];

      if (template !== undefined) {
        entries.push({
          stream,
          timestampNs: bucketStartNs + BigInt(offsetNs),
          ordinal,
          line: renderTemplate(template.segments, random, relativeMs + offsetNs / 1e6, this.traces),
        });
      }
    }
    return entries;
  }
}

/** Oldest first; simultaneous lines by stream, then by generation order. */
function compareEntries(left: ILogEntry, right: ILogEntry): number {
  if (left.timestampNs !== right.timestampNs) {
    return left.timestampNs < right.timestampNs ? -1 : 1;
  }
  return left.stream.key - right.stream.key || left.ordinal - right.ordinal;
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
