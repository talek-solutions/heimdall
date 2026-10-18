import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ITranscriptConfig } from '../config/transcript-config.model';
import { TranscriptError, TranscriptErrorCode } from '../errors';
import { decodeTranscript, encodeTranscript } from '../format/transcript.codec';
import type { ITranscript } from '../format/transcript.interface';
import { TRANSCRIPT_CONFIG } from '../transcript.tokens';

/** `2026-10-18T09-12-04-311Z-3fa2c1.json`: sorts by time, so retention drops the oldest. */
const TRANSCRIPT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}\.json$/;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

/** Transcripts on disk: only the owner can read them, and only the newest `keep` stay. */
@Injectable()
export class TranscriptStore {
  constructor(@Inject(TRANSCRIPT_CONFIG) private readonly config: ITranscriptConfig) {}

  /** Into the runs directory, pruned to `keep`; returns the path. */
  save(transcript: ITranscript): string {
    mkdirSync(this.config.runsDir, { recursive: true, mode: DIRECTORY_MODE });
    const name = `${transcript.meta.recordedAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`;
    const file = path.join(this.config.runsDir, name);

    this.write(file, transcript);
    this.prune();
    return file;
  }

  write(file: string, transcript: ITranscript): void {
    writeFileSync(file, encodeTranscript(transcript), { mode: FILE_MODE });
  }

  read(file: string): ITranscript {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      throw new TranscriptError(TranscriptErrorCode.NotFound, `no transcript at ${file}`, {
        cause: error,
      });
    }
    return decodeTranscript(text, file);
  }

  private prune(): void {
    const transcripts = readdirSync(this.config.runsDir)
      .filter((name) => TRANSCRIPT_FILE.test(name))
      .sort()
      .reverse();

    for (const name of transcripts.slice(this.config.keep)) {
      rmSync(path.join(this.config.runsDir, name), { force: true });
    }
  }
}
