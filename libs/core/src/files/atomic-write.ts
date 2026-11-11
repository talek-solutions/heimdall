import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** `.<name>.<6 hex>.tmp`: hidden, and matched by no reader's file filter (ADR 0019). */
const TEMPORARY_FILE = /^\..+\.[0-9a-f]{6}\.tmp$/;
const SUFFIX_BYTES = 3;

export interface IAtomicWriteOptions {
  readonly mode?: number;
}

/**
 * Writes beside the target, then renames over it, so a reader sees the old file or the whole new
 * one and never part of it (ADR 0019). The temporary file is removed when the write fails.
 */
export function writeFileAtomic(
  file: string,
  content: string,
  options: IAtomicWriteOptions = {},
): void {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(SUFFIX_BYTES).toString('hex')}.tmp`,
  );

  try {
    writeFileSync(temporary, content, options);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Whether a file name is one `writeFileAtomic` uses while writing: left behind only by a crash. */
export function isAtomicTemporary(name: string): boolean {
  return TEMPORARY_FILE.test(name);
}
