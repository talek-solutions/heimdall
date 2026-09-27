import { parseDuration } from '../engine/duration';
import { unquote } from '../engine/query-matcher';
import type { IGeneratedSpan, IGeneratedTrace } from './trace.generator';

export enum TraceQlOperator {
  Equal = '=',
  NotEqual = '!=',
  Regex = '=~',
  NotRegex = '!~',
  Greater = '>',
  GreaterOrEqual = '>=',
  Less = '<',
  LessOrEqual = '<=',
}

enum TraceQlIntrinsic {
  Name = 'name',
  Status = 'status',
  Kind = 'kind',
  Duration = 'duration',
  TraceDuration = 'traceDuration',
  RootName = 'rootName',
  RootServiceName = 'rootServiceName',
}

enum TraceQlBoolean {
  True = 'true',
  False = 'false',
}

type Value = string | number | boolean;

interface ICondition {
  readonly field: string;
  readonly operator: TraceQlOperator;
  readonly value: Value;
}

/** The subset of TraceQL a fixture can honour; see `parseTraceQuery`. */
export interface ITraceQuery {
  matches(trace: IGeneratedTrace): boolean;
  /** Spans satisfying every span condition; every span when there are none. */
  matchingSpans(trace: IGeneratedTrace): IGeneratedSpan[];
}

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|`[^`]*`/g;
const CONDITION =
  /(?<![\w.])(resource\.[\w.]+|span\.[\w.]+|\.[A-Za-z_][\w.]*|name|status|kind|duration|traceDuration|rootName|rootServiceName)\s*(=~|!~|!=|>=|<=|=|>|<)\s*("(?:[^"\\]|\\.)*"|`[^`]*`|-?\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h)?|[A-Za-z_]\w*)/g;
const DURATION_LITERAL = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)$/;
const NUMBER_LITERAL = /^-?\d+(?:\.\d+)?$/;
const NANOS_PER_UNIT: Readonly<Record<string, number>> = { ns: 1, us: 1e3, µs: 1e3, ms: 1e6 };
const SERVICE_NAME_FIELDS = new Set(['resource.service.name', '.service.name']);
const TRACE_FIELDS = new Set<string>([
  TraceQlIntrinsic.TraceDuration,
  TraceQlIntrinsic.RootName,
  TraceQlIntrinsic.RootServiceName,
]);
const SPAN_ATTRIBUTE_PREFIX = /^(?:span)?\./;
const RESOURCE_PREFIX = 'resource.';

/**
 * Every `field op value` condition in the query is ANDed: span conditions must
 * all hold on one span, trace conditions (`traceDuration`, `rootName`,
 * `rootServiceName`) on the trace. `||`, structural operators and aggregates are
 * not evaluated.
 */
export function parseTraceQuery(query: string): ITraceQuery {
  const literals = [...query.matchAll(STRING_LITERAL)].map((literal) => [literal.index, literal.index + literal[0].length] as const);
  const conditions = [...query.matchAll(CONDITION)]
    .filter((match) => !literals.some(([start, end]) => match.index > start && match.index < end))
    .map(([, field = '', operator, value = '']) => ({ field, operator: operator as TraceQlOperator, value: parseValue(value) }));
  const spanConditions = conditions.filter((condition) => !TRACE_FIELDS.has(condition.field));
  const traceConditions = conditions.filter((condition) => TRACE_FIELDS.has(condition.field));

  const matchingSpans = (trace: IGeneratedTrace): IGeneratedSpan[] =>
    trace.spans.filter((span) => spanConditions.every((condition) => holds(spanField(span, condition.field), condition)));

  return {
    matchingSpans,
    matches: (trace) =>
      traceConditions.every((condition) => holds(traceField(trace, condition.field), condition)) &&
      matchingSpans(trace).length > 0,
  };
}

function spanField(span: IGeneratedSpan, field: string): Value | undefined {
  if (SERVICE_NAME_FIELDS.has(field)) {
    return span.service;
  }
  switch (field) {
    case TraceQlIntrinsic.Name:
      return span.name;
    case TraceQlIntrinsic.Status:
      return span.status;
    case TraceQlIntrinsic.Kind:
      return span.kind;
    case TraceQlIntrinsic.Duration:
      return Number(span.durationNs);
    default:
      // Only `service.name` exists at resource level.
      return field.startsWith(RESOURCE_PREFIX) ? undefined : span.attributes[field.replace(SPAN_ATTRIBUTE_PREFIX, '')];
  }
}

function traceField(trace: IGeneratedTrace, field: string): Value | undefined {
  const root = trace.spans[0];

  switch (field) {
    case TraceQlIntrinsic.TraceDuration:
      return root === undefined ? undefined : Number(root.durationNs);
    case TraceQlIntrinsic.RootName:
      return root?.name;
    case TraceQlIntrinsic.RootServiceName:
      return root?.service;
    default:
      return undefined;
  }
}

/** A missing field never matches, `!=` included, as in TraceQL. */
function holds(actual: Value | undefined, condition: ICondition): boolean {
  if (actual === undefined) {
    return false;
  }
  const { operator, value } = condition;

  switch (operator) {
    case TraceQlOperator.Equal:
      return String(actual) === String(value);
    case TraceQlOperator.NotEqual:
      return String(actual) !== String(value);
    case TraceQlOperator.Regex:
      return fullMatch(String(value), String(actual));
    case TraceQlOperator.NotRegex:
      return !fullMatch(String(value), String(actual));
    case TraceQlOperator.Greater:
      return Number(actual) > Number(value);
    case TraceQlOperator.GreaterOrEqual:
      return Number(actual) >= Number(value);
    case TraceQlOperator.Less:
      return Number(actual) < Number(value);
    case TraceQlOperator.LessOrEqual:
      return Number(actual) <= Number(value);
  }
}

/** Durations become nanoseconds, to compare with span durations. */
function parseValue(text: string): Value {
  if (text.startsWith('"') || text.startsWith('`')) {
    return unquote(text);
  }
  const duration = DURATION_LITERAL.exec(text);
  if (duration !== null) {
    const [, amount = '0', unit = 'ns'] = duration;
    const perUnit = NANOS_PER_UNIT[unit] ?? (parseDuration(`1${unit}`) ?? 0) * 1e6;
    return Number(amount) * perUnit;
  }
  if (NUMBER_LITERAL.test(text)) {
    return Number(text);
  }
  if (text === TraceQlBoolean.True || text === TraceQlBoolean.False) {
    return text === TraceQlBoolean.True;
  }
  return text;
}

function fullMatch(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}
