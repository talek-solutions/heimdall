export enum LabelMatchOperator {
  Equal = '=',
  NotEqual = '!=',
  RegexMatch = '=~',
  RegexNoMatch = '!~',
}

export interface ILabelMatcher {
  readonly name: string;
  readonly operator: LabelMatchOperator;
  readonly value: string;
}

export interface IMatchable {
  /** Candidates sharing a `match` pattern share the same `RegExp` instance. */
  readonly match: RegExp;
  readonly labels: Readonly<Record<string, string>>;
}

const STRING_LITERAL_AT = /"(?:[^"\\]|\\.)*"|`[^`]*`/y;
const LABEL_MATCHER_AT = /([A-Za-z_]\w*)\s*(=~|!~|!=|=)\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/y;
const IDENTIFIER_START = /[A-Za-z_]/;
/** A dotted or mid-word position is part of something else, e.g. TraceQL's `resource.service.name`. */
const IDENTIFIER_CONTINUATION = /[.\w]/;

/**
 * For query results (metric series). The fixture cannot evaluate PromQL or LogQL, so it routes instead:
 * 1. the FIRST `match` pattern that tests true against the query wins, and every
 *    candidate sharing that pattern is in play (so specific patterns go first);
 * 2. label matchers written in the query (`service="checkout"`, `code=~"5.."`)
 *    narrow those candidates, for the labels a candidate actually has.
 */
export function selectMatching<T extends IMatchable>(query: string, candidates: readonly T[]): T[] {
  const family = candidates.find((candidate) => candidate.match.test(query))?.match;

  if (family === undefined) {
    return [];
  }
  const matchers = extractLabelMatchers(query);

  return candidates.filter(
    (candidate) => candidate.match === family && labelsSatisfy(candidate.labels, matchers),
  );
}

/**
 * For raw data (log streams, trace templates) rather than query results: every
 * candidate whose pattern tests true, narrowed by the query's label matchers.
 */
export function selectAllMatching<T extends IMatchable>(query: string, candidates: readonly T[]): T[] {
  const matchers = extractLabelMatchers(query);
  return candidates.filter((candidate) => candidate.match.test(query) && labelsSatisfy(candidate.labels, matchers));
}

/** `name op "value"` pairs outside string literals; anything else in the query is ignored. */
export function extractLabelMatchers(query: string): ILabelMatcher[] {
  const matchers: ILabelMatcher[] = [];
  let position = 0;

  while (position < query.length) {
    STRING_LITERAL_AT.lastIndex = position;
    const literal = STRING_LITERAL_AT.exec(query);

    if (literal !== null) {
      position += literal[0].length;
      continue;
    }
    const matcher = startsIdentifier(query, position) ? matchAt(query, position) : undefined;

    if (matcher === undefined) {
      position += 1;
      continue;
    }
    matchers.push(matcher.matcher);
    position += matcher.length;
  }
  return matchers;
}

/** A matcher on a label the candidate lacks is ignored: the query may aggregate it away. */
export function labelsSatisfy(
  labels: Readonly<Record<string, string>>,
  matchers: readonly ILabelMatcher[],
): boolean {
  return matchers.every((matcher) => {
    const actual = labels[matcher.name];

    if (actual === undefined) {
      return true;
    }
    switch (matcher.operator) {
      case LabelMatchOperator.Equal:
        return actual === matcher.value;
      case LabelMatchOperator.NotEqual:
        return actual !== matcher.value;
      case LabelMatchOperator.RegexMatch:
        return fullMatch(matcher.value, actual) ?? true;
      case LabelMatchOperator.RegexNoMatch:
        return !(fullMatch(matcher.value, actual) ?? false);
    }
  });
}

function startsIdentifier(query: string, position: number): boolean {
  return (
    IDENTIFIER_START.test(query.charAt(position)) &&
    (position === 0 || !IDENTIFIER_CONTINUATION.test(query.charAt(position - 1)))
  );
}

function matchAt(
  query: string,
  position: number,
): { readonly matcher: ILabelMatcher; readonly length: number } | undefined {
  LABEL_MATCHER_AT.lastIndex = position;
  const match = LABEL_MATCHER_AT.exec(query);

  if (match === null) {
    return undefined;
  }
  const [text, name = '', operator = '', quoted = '""'] = match;
  return {
    matcher: { name, operator: operator as LabelMatchOperator, value: unquote(quoted) },
    length: text.length,
  };
}

/** Label regexes are fully anchored, as in PromQL and LogQL. `undefined` for an invalid pattern. */
function fullMatch(pattern: string, value: string): boolean | undefined {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return undefined;
  }
}

/** A PromQL/LogQL string literal's value: backticks are raw, double quotes unescape. */
export function unquote(quoted: string): string {
  const body = quoted.slice(1, -1);
  return quoted.startsWith('`') ? body : body.replace(/\\(.)/g, '$1');
}
