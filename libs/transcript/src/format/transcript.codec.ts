import { TranscriptError, TranscriptErrorCode } from '../errors';
import { TranscriptVersion } from '../transcript.enums';
import type { ITranscript } from './transcript.interface';

const NUMBER_KEY = '$number';
const INDENT = '  ';
/** A value whose JSON fits in this many characters stays on one line. */
const LINE_WIDTH = 100;

/**
 * JSON with the numbers JSON cannot hold (`NaN`, `±Infinity`) kept as `{ "$number": "NaN" }`.
 * Indented, but a value that fits on a line stays on one, so a metric point or a log record is
 * one line and a changed value is a one-line diff.
 */
export function encodeTranscript(transcript: ITranscript): string {
  return `${print(JSON.parse(JSON.stringify(transcript, encodeNumber)) as unknown, '')}\n`;
}

export function decodeTranscript(text: string, origin: string): ITranscript {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, decodeNumber);
  } catch (error) {
    throw new TranscriptError(TranscriptErrorCode.Invalid, `${origin} is not JSON`, {
      cause: error,
    });
  }
  if (!isRecord(parsed) || parsed['version'] === undefined) {
    throw new TranscriptError(TranscriptErrorCode.Invalid, `${origin} is not a transcript`);
  }
  if (parsed['version'] !== TranscriptVersion.V1) {
    throw new TranscriptError(
      TranscriptErrorCode.Invalid,
      `${origin} is transcript version ${String(parsed['version'])}; this build reads version ${TranscriptVersion.V1}`,
    );
  }
  for (const key of ['meta', 'environment', 'pins', 'outcome']) {
    if (!isRecord(parsed[key])) {
      throw new TranscriptError(TranscriptErrorCode.Invalid, `${origin} has no ${key}`);
    }
  }
  if (!Array.isArray(parsed['model']) || !Array.isArray(parsed['telemetry'])) {
    throw new TranscriptError(
      TranscriptErrorCode.Invalid,
      `${origin} has no model or telemetry calls`,
    );
  }
  return parsed as unknown as ITranscript;
}

/** A deep copy through the same encoding, so a kept value cannot change under the recorder. */
export function snapshot<T>(value: T): T {
  return value === undefined
    ? value
    : (JSON.parse(JSON.stringify(value, encodeNumber), decodeNumber) as T);
}

/** JSON with sorted keys: equal values give equal text, whatever order they were built in. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (key, entry: unknown) => {
    const encoded = encodeNumber(key, entry);
    return isRecord(encoded) && !Array.isArray(encoded)
      ? Object.fromEntries(Object.entries(encoded).sort(([a], [b]) => a.localeCompare(b)))
      : encoded;
  });
}

function print(value: unknown, indent: string): string {
  const flat = JSON.stringify(value);

  if (typeof value !== 'object' || value === null || flat.length + indent.length <= LINE_WIDTH) {
    return flat;
  }
  const inner = `${indent}${INDENT}`;

  if (Array.isArray(value)) {
    return value.length === 0
      ? '[]'
      : `[\n${value.map((item) => `${inner}${print(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);

  return entries.length === 0
    ? '{}'
    : `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${print(item, inner)}`).join(',\n')}\n${indent}}`;
}

function encodeNumber(_key: string, value: unknown): unknown {
  return typeof value === 'number' && !Number.isFinite(value)
    ? { [NUMBER_KEY]: String(value) }
    : value;
}

function decodeNumber(_key: string, value: unknown): unknown {
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value[NUMBER_KEY] === 'string') {
    return Number(value[NUMBER_KEY]);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
