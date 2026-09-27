import { parseDuration } from '../engine/duration';
import { unquote } from '../engine/query-matcher';
import { FixtureRequestError } from '../fixture-backend';

export enum LineFilterOperator {
  Contains = '|=',
  NotContains = '!=',
  Matches = '|~',
  NotMatches = '!~',
}

export type LinePredicate = (line: string) => boolean;

const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|`[^`]*`/g;
const STRING_LITERAL_AT = /"(?:[^"\\]|\\.)*"|`[^`]*`/y;
const LINE_FILTER_AT = /(\|=|!=|\|~|!~)\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/y;
/** A range vector (`[5m]`, `[$__auto]`) outside a string is what makes LogQL a metric query. */
const RANGE_SELECTOR = /\[\s*(?:(?:\d+(?:ms|s|m|h|d|w|y))+|\$__\w+)\s*\]/;
const RANGE_DURATION = /\[\s*((?:\d+(?:ms|s|m|h|d|w))+)\s*\]/;
/** `!=`/`!~` after a name is a label filter (`| status != "200"`), not a line filter. */
const LABEL_NAME_CHARACTER = /\w/;
/** RE2's leading `(?i)` has no JavaScript equivalent other than the `i` flag. */
const CASE_INSENSITIVE_PREFIX = '(?i)';

export function isMetricQuery(query: string): boolean {
  return RANGE_SELECTOR.test(query.replace(STRING_LITERAL, '""'));
}

/** The first range selector's duration, e.g. 300000 for `[5m]`; `undefined` if none is literal. */
export function rangeSelectorMs(query: string): number | undefined {
  const duration = RANGE_DURATION.exec(query.replace(STRING_LITERAL, '""'))?.[1];
  return duration === undefined ? undefined : parseDuration(duration);
}

/**
 * The line filters of a log query, applied to generated lines. Parsers and
 * label filters after them are not evaluated; only the lines are.
 */
export function compileLineFilters(query: string): LinePredicate {
  const predicates: LinePredicate[] = [];
  let position = 0;

  while (position < query.length) {
    LINE_FILTER_AT.lastIndex = position;
    const filter = LINE_FILTER_AT.exec(query);

    if (filter !== null && isLineFilterPosition(query, position)) {
      predicates.push(toPredicate(filter[1] as LineFilterOperator, unquote(filter[2] ?? '""')));
      position += filter[0].length;
      continue;
    }
    STRING_LITERAL_AT.lastIndex = position;
    const literal = STRING_LITERAL_AT.exec(query);
    position += literal === null ? 1 : literal[0].length;
  }
  return (line) => predicates.every((predicate) => predicate(line));
}

function isLineFilterPosition(query: string, position: number): boolean {
  if (query.charAt(position) === '|') {
    return true;
  }
  const before = query.slice(0, position).trimEnd();
  return !LABEL_NAME_CHARACTER.test(before.charAt(before.length - 1));
}

function toPredicate(operator: LineFilterOperator, value: string): LinePredicate {
  switch (operator) {
    case LineFilterOperator.Contains:
      return (line) => line.includes(value);
    case LineFilterOperator.NotContains:
      return (line) => !line.includes(value);
    case LineFilterOperator.Matches: {
      const regex = compileRegex(value);
      return (line) => regex.test(line);
    }
    case LineFilterOperator.NotMatches: {
      const regex = compileRegex(value);
      return (line) => !regex.test(line);
    }
  }
}

function compileRegex(pattern: string): RegExp {
  const insensitive = pattern.startsWith(CASE_INSENSITIVE_PREFIX);
  const source = insensitive ? pattern.slice(CASE_INSENSITIVE_PREFIX.length) : pattern;

  try {
    return new RegExp(source, insensitive ? 'i' : '');
  } catch {
    throw new FixtureRequestError(`parse error : invalid regular expression ${JSON.stringify(pattern)}`);
  }
}
