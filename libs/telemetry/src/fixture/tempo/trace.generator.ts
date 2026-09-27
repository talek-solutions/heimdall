import { TempoSpanKind, TempoStatusCode } from '../../connectors/tempo/tempo.enums';
import { DeterministicRandom } from '../engine/deterministic-random';
import type { Timeline } from '../engine/timeline';
import { TEMPO_MAX_SCANNED_TRACES, TRACE_LOOKBACK_BUCKETS } from '../fixture-backend.constants';
import { hex, type ITraceIdSource } from '../loki/log-template';
import type { ISpanTemplate, ITraceTemplate, SpanAttributeValue } from '../scenario/scenario.model';
import type { TraceIdCodec } from './trace-id.codec';

export interface IGeneratedSpanEvent {
  readonly name: string;
  readonly timeNs: bigint;
  readonly attributes: Readonly<Record<string, SpanAttributeValue>>;
}

export interface IGeneratedSpan {
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly service: string;
  readonly name: string;
  readonly kind: TempoSpanKind;
  readonly startNs: bigint;
  readonly durationNs: bigint;
  readonly status: TempoStatusCode;
  readonly statusMessage: string | undefined;
  readonly attributes: Readonly<Record<string, SpanAttributeValue>>;
  readonly events: readonly IGeneratedSpanEvent[];
}

export interface IGeneratedTrace {
  readonly traceId: string;
  readonly startNs: bigint;
  readonly isError: boolean;
  /** Depth-first; the root first. */
  readonly spans: readonly IGeneratedSpan[];
}

export interface ITraceWindow {
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly limit: number;
  accept(trace: IGeneratedTrace): boolean;
}

interface ITraceHeader {
  readonly startNs: bigint;
  readonly relativeMs: number;
  readonly isError: boolean;
}

interface ILayoutContext {
  readonly random: DeterministicRandom;
  readonly relativeMs: number;
  readonly errorSource: ISpanTemplate | undefined;
  readonly errorPath: ReadonlySet<ISpanTemplate>;
  readonly spans: IGeneratedSpan[];
}

const BUCKET_MS = 1_000;
const NANOS_PER_MILLI = 1_000_000n;
const MAX_OFFSET_NS = 999_999_999;
const SPAN_ID_HEX_LENGTH = 16;
const MAX_ORDINAL = 0xffff;
const MIN_DURATION_MS = 0.05;
/** Children never fill their parent completely: there is always some own time. */
const MAX_CHILDREN_SHARE = 0.95;
const MAX_GAP_SHARE = 0.01;
const CHILD_JITTER = 0.05;
/** Error traces with an `errorDuration` (typically a timeout) vary far less. */
const ERROR_JITTER_FACTOR = 0.1;
const EXCEPTION_EVENT = 'exception';
const EXCEPTION_MESSAGE = 'exception.message';

/**
 * Traces exist per (template, second, ordinal): the second's PRNG fixes how many,
 * and each trace's own PRNG fixes everything about it. So any trace can be
 * regenerated from its ID alone, and a log line can reference one that exists.
 */
export class TraceGenerator implements ITraceIdSource {
  private readonly byId: ReadonlyMap<string, ITraceTemplate>;

  constructor(
    private readonly templates: readonly ITraceTemplate[],
    private readonly seed: number,
    private readonly timeline: Timeline,
    private readonly codec: TraceIdCodec,
  ) {
    this.byId = new Map(templates.map((template) => [template.id, template]));
  }

  /** `undefined` for an ID this scenario never issued, or a trace after the anchor. */
  public find(traceId: string): IGeneratedTrace | undefined {
    const address = this.codec.decode(traceId);
    const template = address === undefined ? undefined : this.templates[address.template];

    if (address === undefined || template === undefined || address.ordinal >= this.count(template, address.bucket)) {
      return undefined;
    }
    const trace = this.generate(template, address.bucket, address.ordinal);
    return trace.startNs <= this.anchorNs() ? trace : undefined;
  }

  /** The latest trace of `template` that started at or before the line; errors only if asked. */
  public traceIdNear(templateId: string, relativeMs: number, errorOnly: boolean): string | undefined {
    const template = this.byId.get(templateId);

    if (template === undefined) {
      return undefined;
    }
    const lineNs = this.startNs(0) + BigInt(Math.round(relativeMs * 1e6));
    const first = Math.floor(relativeMs / BUCKET_MS);

    for (let bucket = first; bucket > first - TRACE_LOOKBACK_BUCKETS; bucket -= 1) {
      for (let ordinal = this.count(template, bucket) - 1; ordinal >= 0; ordinal -= 1) {
        const header = this.header(template, bucket, this.random(template, bucket, ordinal));

        if (header.startNs <= lineNs && (!errorOnly || header.isError)) {
          return this.codec.encode({ template: template.index, bucket, ordinal });
        }
      }
    }
    return undefined;
  }

  /** Newest first, walking back one second at a time until `limit` traces are accepted. */
  public collect(templates: readonly ITraceTemplate[], window: ITraceWindow): IGeneratedTrace[] {
    const endNs = window.endNs < this.anchorNs() ? window.endNs : this.anchorNs();

    if (templates.length === 0 || endNs < window.startNs) {
      return [];
    }
    const firstBucket = this.bucketOf(window.startNs);
    const found: IGeneratedTrace[] = [];
    let scanned = 0;

    for (let bucket = this.bucketOf(endNs); bucket >= firstBucket; bucket -= 1) {
      const accepted: IGeneratedTrace[] = [];

      for (const template of templates) {
        const count = this.count(template, bucket);
        scanned += count;

        for (let ordinal = 0; ordinal < count; ordinal += 1) {
          const trace = this.generate(template, bucket, ordinal);
          if (trace.startNs >= window.startNs && trace.startNs <= endNs && window.accept(trace)) {
            accepted.push(trace);
          }
        }
      }
      found.push(...accepted.sort(newestFirst));

      if (found.length >= window.limit || scanned >= TEMPO_MAX_SCANNED_TRACES) {
        break;
      }
    }
    return found.slice(0, window.limit);
  }

  private count(template: ITraceTemplate, bucket: number): number {
    const perSecond = Math.max(0, template.rate.valueAt(bucket * BUCKET_MS));
    const count = DeterministicRandom.of([this.seed, template.key, bucket]).poisson((perSecond * BUCKET_MS) / 1_000);
    return Math.min(count, MAX_ORDINAL + 1);
  }

  private random(template: ITraceTemplate, bucket: number, ordinal: number): DeterministicRandom {
    return DeterministicRandom.of([this.seed, template.key, bucket, ordinal]);
  }

  /** The first draws of a trace's PRNG, cheap enough to scan for log references. */
  private header(template: ITraceTemplate, bucket: number, random: DeterministicRandom): ITraceHeader {
    const offsetNs = random.integer(0, MAX_OFFSET_NS);
    const relativeMs = bucket * BUCKET_MS + offsetNs / 1e6;
    const errorProbability = Math.min(1, Math.max(0, template.error.valueAt(relativeMs)));

    return {
      startNs: this.startNs(bucket) + BigInt(offsetNs),
      relativeMs,
      isError: random.next() < errorProbability,
    };
  }

  private generate(template: ITraceTemplate, bucket: number, ordinal: number): IGeneratedTrace {
    const random = this.random(template, bucket, ordinal);
    const header = this.header(template, bucket, random);
    const errorSource = header.isError
      ? template.errorSources[random.integer(0, template.errorSources.length - 1)]
      : undefined;
    const context: ILayoutContext = {
      random,
      relativeMs: header.relativeMs,
      errorSource,
      errorPath: new Set(errorSource === undefined ? [] : pathTo(template.root, errorSource)),
      spans: [],
    };

    this.layout(template.root, undefined, header.startNs, this.rootDurationMs(template, header, random) * 1e6, context);
    return {
      traceId: this.codec.encode({ template: template.index, bucket, ordinal }),
      startNs: header.startNs,
      isError: header.isError,
      spans: context.spans,
    };
  }

  /** Log-normal around the median, so most traces sit near it and a few run long. */
  private rootDurationMs(template: ITraceTemplate, header: ITraceHeader, random: DeterministicRandom): number {
    const timesOut = header.isError && template.errorDuration !== undefined;
    const median = (timesOut ? template.errorDuration : template.duration)?.valueAt(header.relativeMs) ?? 0;
    const spread = timesOut ? template.jitter * ERROR_JITTER_FACTOR : template.jitter;

    return Math.max(MIN_DURATION_MS, median * Math.exp(spread * random.gaussian()));
  }

  private layout(
    span: ISpanTemplate,
    parentSpanId: string | undefined,
    startNs: bigint,
    durationNs: number,
    context: ILayoutContext,
  ): void {
    const { random } = context;
    const spanId = hex(random, SPAN_ID_HEX_LENGTH);
    const endNs = startNs + BigInt(Math.round(durationNs));
    const inError = context.errorPath.has(span);
    const isSource = span === context.errorSource;

    context.spans.push({
      spanId,
      parentSpanId,
      service: span.service,
      name: span.name,
      kind: span.kind,
      startNs,
      durationNs: endNs - startNs,
      status: inError ? TempoStatusCode.Error : TempoStatusCode.Unset,
      statusMessage: isSource ? span.errorMessage : undefined,
      attributes: inError ? { ...span.attributes, ...span.errorAttributes } : span.attributes,
      events:
        isSource && span.errorMessage !== undefined
          ? [{ name: EXCEPTION_EVENT, timeNs: endNs, attributes: { [EXCEPTION_MESSAGE]: span.errorMessage } }]
          : [],
    });

    const shares = span.children.map((child) => Math.min(1, Math.max(0, child.share.valueAt(context.relativeMs))));
    const total = shares.reduce((sum, share) => sum + share, 0);
    const fit = total > MAX_CHILDREN_SHARE ? MAX_CHILDREN_SHARE / total : 1;
    let cursorNs = startNs;

    for (const [index, child] of span.children.entries()) {
      const childStartNs = cursorNs + BigInt(Math.round(durationNs * MAX_GAP_SHARE * random.next()));
      const remainingNs = Number(endNs - childStartNs);
      const wantedNs = durationNs * (shares[index] ?? 0) * fit * (1 + CHILD_JITTER * random.gaussian());
      const childDurationNs = Math.max(0, Math.min(remainingNs, wantedNs));

      this.layout(child, spanId, childStartNs, childDurationNs, context);
      cursorNs = childStartNs + BigInt(Math.round(childDurationNs));
    }
  }

  private bucketOf(timestampNs: bigint): number {
    return Math.floor(this.timeline.relative(Number(timestampNs / NANOS_PER_MILLI)) / BUCKET_MS);
  }

  private startNs(bucket: number): bigint {
    return BigInt(this.timeline.startMs + bucket * BUCKET_MS) * NANOS_PER_MILLI;
  }

  private anchorNs(): bigint {
    return BigInt(this.timeline.anchorMs) * NANOS_PER_MILLI;
  }
}

function pathTo(root: ISpanTemplate, target: ISpanTemplate): ISpanTemplate[] {
  if (root === target) {
    return [root];
  }
  for (const child of root.children) {
    const path = pathTo(child, target);
    if (path.length > 0) {
      return [root, ...path];
    }
  }
  return [];
}

function newestFirst(left: IGeneratedTrace, right: IGeneratedTrace): number {
  if (left.startNs !== right.startNs) {
    return left.startNs > right.startNs ? -1 : 1;
  }
  return left.traceId < right.traceId ? -1 : 1;
}
