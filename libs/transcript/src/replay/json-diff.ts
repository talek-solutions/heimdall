import { canonical } from '../format/transcript.codec';

export interface IValueChange {
  /** `templates.new[3].confirmedAbsent`; empty for the value itself. */
  readonly path: string;
  readonly recorded: string;
  readonly replayed: string;
}

const MAX_SHOWN = 80;
const ABSENT = '(absent)';

/** Where two JSON values differ, deepest first found, at most `limit`. */
export function diffValues(recorded: unknown, replayed: unknown, limit: number): IValueChange[] {
  const changes: IValueChange[] = [];
  walk(recorded, replayed, '', changes, limit);
  return changes;
}

function walk(
  recorded: unknown,
  replayed: unknown,
  path: string,
  changes: IValueChange[],
  limit: number,
): void {
  if (changes.length >= limit || canonical(recorded) === canonical(replayed)) {
    return;
  }
  if (Array.isArray(recorded) && Array.isArray(replayed)) {
    for (let index = 0; index < Math.max(recorded.length, replayed.length); index += 1) {
      walk(recorded[index], replayed[index], `${path}[${index}]`, changes, limit);
    }
    return;
  }
  if (isRecord(recorded) && isRecord(replayed)) {
    for (const key of [...new Set([...Object.keys(recorded), ...Object.keys(replayed)])].sort()) {
      walk(recorded[key], replayed[key], path === '' ? key : `${path}.${key}`, changes, limit);
    }
    return;
  }
  changes.push({ path, recorded: shown(recorded), replayed: shown(replayed) });
}

function shown(value: unknown): string {
  if (value === undefined) {
    return ABSENT;
  }
  const text = canonical(value);
  return text.length <= MAX_SHOWN ? text : `${text.slice(0, MAX_SHOWN)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
