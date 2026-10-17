/** Why a scrubbing pattern is refused (`.docs/design/redaction-and-scrubbers.md`, Pattern rules). */
export enum PatternRisk {
  Invalid = 'invalid',
  TooLong = 'tooLong',
  Backreference = 'backreference',
  MatchesEmpty = 'matchesEmpty',
  NestedRepetition = 'nestedRepetition',
}

export const MAX_PATTERN_LENGTH = 256;

export const PATTERN_RISK_MESSAGES: Readonly<Record<PatternRisk, string>> = {
  [PatternRisk.Invalid]: 'is not a valid regular expression',
  [PatternRisk.TooLong]: `is longer than ${MAX_PATTERN_LENGTH} characters`,
  [PatternRisk.Backreference]: 'uses a backreference, which can make matching exponential',
  [PatternRisk.MatchesEmpty]: 'matches an empty string',
  [PatternRisk.NestedRepetition]:
    'repeats a group that itself contains a quantifier or an alternation, which can make matching exponential',
};

interface IGroupFrame {
  quantified: boolean;
  alternated: boolean;
}

const BOUNDED_QUANTIFIER = /^\{(\d+)(,(\d*))?\}/;
const GROUP_PREFIX = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>|[ims]*-?[ims]*:)/;

/**
 * A static check, so a pattern is refused at load rather than stalling a run: no backreferences,
 * and no repeated group that holds a quantifier or an alternation (star height above one is where
 * catastrophic backtracking lives). Exact `{n}` repetition is not a quantifier here.
 */
export function patternRisk(pattern: string): PatternRisk | undefined {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return PatternRisk.TooLong;
  }
  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern);
  } catch {
    return PatternRisk.Invalid;
  }
  if (compiled.test('')) {
    return PatternRisk.MatchesEmpty;
  }
  return scan(pattern);
}

function scan(pattern: string): PatternRisk | undefined {
  const stack: IGroupFrame[] = [{ quantified: false, alternated: false }];
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    const frame = stack.at(-1) as IGroupFrame;

    if (char === '\\') {
      const next = pattern[index + 1] ?? '';

      if (/[1-9]/.test(next) || (next === 'k' && pattern[index + 2] === '<')) {
        return PatternRisk.Backreference;
      }
      index += escapeLength(pattern, index);
      index += quantifier(pattern, index, frame);
      continue;
    }
    if (char === '[') {
      index += classLength(pattern, index);
      index += quantifier(pattern, index, frame);
      continue;
    }
    if (char === '(') {
      const prefix = GROUP_PREFIX.exec(pattern.slice(index + 1));

      stack.push({ quantified: false, alternated: false });
      index += 1 + (prefix?.[0].length ?? 0);
      continue;
    }
    if (char === ')') {
      const closed = stack.length > 1 ? (stack.pop() as IGroupFrame) : frame;
      const parent = stack.at(-1) as IGroupFrame;
      const repeated = quantifierLength(pattern, index + 1);

      if (repeated > 0 && (closed.quantified || closed.alternated)) {
        return PatternRisk.NestedRepetition;
      }
      parent.quantified ||= closed.quantified || repeated > 0;
      parent.alternated ||= closed.alternated;
      index += 1 + repeated;
      continue;
    }
    if (char === '|') {
      frame.alternated = true;
      index += 1;
      continue;
    }
    index += 1;
    index += quantifier(pattern, index, frame);
  }
  return undefined;
}

/** Consumes a quantifier after an atom, marking the group; 0 when there is none. */
function quantifier(pattern: string, index: number, frame: IGroupFrame): number {
  const length = quantifierLength(pattern, index);

  if (length > 0) {
    frame.quantified = true;
  }
  return length;
}

/** `*`, `+`, `?`, `{n,}` or `{n,m}`, with a lazy `?`; exact `{n}` counts as no quantifier. */
function quantifierLength(pattern: string, index: number): number {
  const char = pattern[index];
  let length = 0;

  if (char === '*' || char === '+' || char === '?') {
    length = 1;
  } else if (char === '{') {
    const bounded = BOUNDED_QUANTIFIER.exec(pattern.slice(index));

    if (bounded === null || bounded[2] === undefined || bounded[3] === bounded[1]) {
      return 0;
    }
    length = bounded[0].length;
  }
  return length > 0 && pattern[index + length] === '?' ? length + 1 : length;
}

function escapeLength(pattern: string, index: number): number {
  const next = pattern[index + 1];

  if ((next === 'p' || next === 'P' || next === 'u') && pattern[index + 2] === '{') {
    const close = pattern.indexOf('}', index + 3);
    return close === -1 ? 2 : close - index + 1;
  }
  return 2;
}

function classLength(pattern: string, index: number): number {
  let cursor = index + 1;

  while (cursor < pattern.length && pattern[cursor] !== ']') {
    cursor += pattern[cursor] === '\\' ? 2 : 1;
  }
  return cursor - index + 1;
}
