import type { ICurve } from '../engine/curve';
import type { DeterministicRandom } from '../engine/deterministic-random';
import { formatSampleValue } from '../engine/sample-format';

export enum PlaceholderKind {
  Uuid = 'uuid',
  Hex = 'hex',
  Int = 'int',
  Pick = 'pick',
  Ref = 'ref',
  TraceId = 'traceId',
}

export type TemplateSegment =
  | string
  | { readonly kind: PlaceholderKind.Uuid }
  | { readonly kind: PlaceholderKind.Hex; readonly length: number }
  | { readonly kind: PlaceholderKind.Int; readonly min: number; readonly max: number }
  | { readonly kind: PlaceholderKind.Pick; readonly options: readonly string[] }
  | { readonly kind: PlaceholderKind.Ref; readonly curve: ICurve; readonly factor: number | undefined }
  | { readonly kind: PlaceholderKind.TraceId; readonly template: string; readonly errorOnly: boolean };

/** Resolves `{traceId:…}` to an ID the Tempo fixture can serve. */
export interface ITraceIdSource {
  traceIdNear(template: string, relativeMs: number, errorOnly: boolean): string | undefined;
}

export interface ITemplateContext {
  /** The target curve, or `undefined` after recording an issue. */
  resolveRef(id: string, path: string): ICurve | undefined;
  hasTraceTemplate(id: string): boolean;
  readonly issues: string[];
}

/**
 * `{name}` or `{name:args}` where name is a word; `{"json":…}` and `{{.go}}` stay
 * literal, and `\{id}` writes a literal `{id}` (e.g. a route template).
 */
const PLACEHOLDER = /(?<!\\)\{([A-Za-z]+)(?::([^{}]*))?\}/g;
const ESCAPED_BRACE = /\\\{/g;
const INT_RANGE = /^(\d+)-(\d+)$/;
const REF_ARGS = /^([a-z][a-z0-9_]*)(?:\*(\d+(?:\.\d+)?))?$/;
const TRACE_ARGS = /^([a-z][a-z0-9_]*)(?::(error))?$/;
const MAX_HEX_LENGTH = 64;
const UUID_GROUPS = [8, 4, 4, 4, 12];
const HEX_RADIX = 16;
/** A trace ID in a log line that points nowhere, as for an unsampled request. */
const UNSAMPLED_TRACE_HEX_LENGTH = 32;

export function compileTemplate(line: string, path: string, context: ITemplateContext): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let cursor = 0;

  for (const match of line.matchAll(PLACEHOLDER)) {
    if (match.index > cursor) {
      segments.push(unescape(line.slice(cursor, match.index)));
    }
    segments.push(compilePlaceholder(match[1] ?? '', match[2], `${path}: {${match[1]}}`, context));
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) {
    segments.push(unescape(line.slice(cursor)));
  }
  return segments;
}

function unescape(literal: string): string {
  return literal.replace(ESCAPED_BRACE, '{');
}

export function renderTemplate(
  segments: readonly TemplateSegment[],
  random: DeterministicRandom,
  relativeMs: number,
  traces: ITraceIdSource | undefined,
): string {
  return segments
    .map((segment) => (typeof segment === 'string' ? segment : renderPlaceholder(segment, random, relativeMs, traces)))
    .join('');
}

function renderPlaceholder(
  segment: Exclude<TemplateSegment, string>,
  random: DeterministicRandom,
  relativeMs: number,
  traces: ITraceIdSource | undefined,
): string {
  switch (segment.kind) {
    case PlaceholderKind.Uuid:
      return uuid(random);
    case PlaceholderKind.Hex:
      return hex(random, segment.length);
    case PlaceholderKind.Int:
      return String(random.integer(segment.min, segment.max));
    case PlaceholderKind.Pick:
      return segment.options[random.integer(0, segment.options.length - 1)] ?? '';
    case PlaceholderKind.Ref: {
      const value = segment.curve.valueAt(relativeMs);
      return segment.factor === undefined ? formatSampleValue(value) : String(Math.round(value * segment.factor));
    }
    case PlaceholderKind.TraceId:
      return (
        traces?.traceIdNear(segment.template, relativeMs, segment.errorOnly) ??
        hex(random, UNSAMPLED_TRACE_HEX_LENGTH)
      );
  }
}

function compilePlaceholder(
  name: string,
  args: string | undefined,
  path: string,
  context: ITemplateContext,
): TemplateSegment {
  const invalid = (reason: string): TemplateSegment => {
    context.issues.push(`${path}: ${reason}`);
    return '';
  };

  switch (name) {
    case PlaceholderKind.Uuid:
      return { kind: PlaceholderKind.Uuid };
    case PlaceholderKind.Hex: {
      const length = Number(args);
      return Number.isInteger(length) && length > 0 && length <= MAX_HEX_LENGTH
        ? { kind: PlaceholderKind.Hex, length }
        : invalid(`expects a length from 1 to ${MAX_HEX_LENGTH}, e.g. {hex:16}`);
    }
    case PlaceholderKind.Int: {
      const range = INT_RANGE.exec(args ?? '');
      const [min, max] = [Number(range?.[1]), Number(range?.[2])];
      return range !== null && min <= max
        ? { kind: PlaceholderKind.Int, min, max }
        : invalid('expects an ascending range, e.g. {int:100-900}');
    }
    case PlaceholderKind.Pick: {
      const options = (args ?? '').split('|');
      return args !== undefined && options.every((option) => option !== '')
        ? { kind: PlaceholderKind.Pick, options }
        : invalid('expects options, e.g. {pick:GET|POST}');
    }
    case PlaceholderKind.Ref: {
      const ref = REF_ARGS.exec(args ?? '');
      if (ref === null) {
        return invalid('expects a metric series id and an optional factor, e.g. {ref:checkout_p99*1000}');
      }
      const curve = context.resolveRef(ref[1] ?? '', path);
      const factor = ref[2] === undefined ? undefined : Number(ref[2]);
      return curve === undefined ? '' : { kind: PlaceholderKind.Ref, curve, factor };
    }
    case PlaceholderKind.TraceId: {
      const trace = TRACE_ARGS.exec(args ?? '');
      if (trace === null || !context.hasTraceTemplate(trace[1] ?? '')) {
        return invalid(`expects a trace template id from traces.yaml, e.g. {traceId:checkout_post:error}`);
      }
      return { kind: PlaceholderKind.TraceId, template: trace[1] ?? '', errorOnly: trace[2] !== undefined };
    }
    default:
      return invalid(`unknown placeholder; expected one of ${Object.values(PlaceholderKind).join(', ')}`);
  }
}

function uuid(random: DeterministicRandom): string {
  const digits = hex(random, 32).split('');
  // RFC 9562 version 4, variant 10xx.
  digits[12] = '4';
  digits[16] = ((Number.parseInt(digits[16] ?? '0', HEX_RADIX) & 0x3) | 0x8).toString(HEX_RADIX);
  let offset = 0;
  return UUID_GROUPS.map((size) => {
    const group = digits.slice(offset, offset + size).join('');
    offset += size;
    return group;
  }).join('-');
}

export function hex(random: DeterministicRandom, length: number): string {
  let text = '';

  while (text.length < length) {
    text += Math.floor(random.next() * 0x1_0000_0000)
      .toString(HEX_RADIX)
      .padStart(8, '0');
  }
  return text.slice(0, length);
}
