export enum LogLineFormat {
  Json = 'json',
  Logfmt = 'logfmt',
  /** Neither: the whole line is the message. */
  Unstructured = 'unstructured',
}

export interface IParsedLogLine {
  readonly format: LogLineFormat;
  /** Raw key → raw value; empty for an unstructured line. */
  readonly fields: ReadonlyMap<string, string>;
}

const MAX_JSON_DEPTH = 3;
const LOGFMT_PAIR = /([^\s="]+)=("(?:[^"\\]|\\.)*"|\S*)/y;
const ESCAPE = /\\(.)/g;
const MIN_LOGFMT_PAIRS = 2;

/**
 * Reads a line the way the allowlist needs it: a JSON object (nested keys dotted, up to three
 * levels), logfmt (at least two pairs, and pairs make up most of the line), or neither.
 */
export function parseLogLine(line: string): IParsedLogLine {
  return json(line) ?? logfmt(line) ?? { format: LogLineFormat.Unstructured, fields: new Map() };
}

function json(line: string): IParsedLogLine | undefined {
  const trimmed = line.trim();

  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const fields = new Map<string, string>();
  flatten(parsed, '', 1, fields);
  return { format: LogLineFormat.Json, fields };
}

function flatten(
  value: Record<string, unknown>,
  prefix: string,
  depth: number,
  into: Map<string, string>,
): void {
  for (const [key, entry] of Object.entries(value)) {
    const name = `${prefix}${key}`;

    if (isRecord(entry) && depth < MAX_JSON_DEPTH) {
      flatten(entry, `${name}.`, depth + 1, into);
    } else {
      into.set(name, typeof entry === 'string' ? entry : JSON.stringify(entry));
    }
  }
}

function logfmt(line: string): IParsedLogLine | undefined {
  const fields = new Map<string, string>();
  let index = 0;
  let pairs = 0;

  while (index < line.length) {
    if (/\s/.test(line[index] ?? '')) {
      index += 1;
      continue;
    }
    LOGFMT_PAIR.lastIndex = index;
    const pair = LOGFMT_PAIR.exec(line);

    if (pair === null) {
      index = nextWhitespace(line, index);
      continue;
    }
    const [whole, key = '', raw = ''] = pair;
    fields.set(
      key,
      raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
        ? raw.slice(1, -1).replace(ESCAPE, '$1')
        : raw,
    );
    pairs += 1;
    index += whole.length;
  }
  return pairs >= MIN_LOGFMT_PAIRS && pairs >= bareTokens(line)
    ? { format: LogLineFormat.Logfmt, fields }
    : undefined;
}

/** Words outside any pair: what tells a sentence with a few `a=b` in it from logfmt. */
function bareTokens(line: string): number {
  return line
    .replace(new RegExp(LOGFMT_PAIR.source, 'g'), ' ')
    .split(/\s+/)
    .filter((token) => token !== '').length;
}

function nextWhitespace(line: string, from: number): number {
  const offset = line.slice(from).search(/\s/);
  return offset === -1 ? line.length : from + offset;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
