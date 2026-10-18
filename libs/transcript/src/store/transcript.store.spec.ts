import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { TranscriptError, TranscriptErrorCode } from '../errors';
import type { ITranscript } from '../format/transcript.interface';
import { TranscriptVersion } from '../transcript.enums';
import { TranscriptStore } from './transcript.store';

const root = mkdtempSync(path.join(os.tmpdir(), 'heimdall-store-'));

function transcript(recordedAt: string): ITranscript {
  return {
    version: TranscriptVersion.V1,
    meta: {
      heimdall: '0.0.0',
      recordedAt,
      command: { query: 'q', planOnly: true },
      manifest: { sha256: 'x', content: '' },
      datasources: {},
    },
    environment: { variables: {} },
    pins: {},
    model: [],
    telemetry: [],
    outcome: { events: [] },
  };
}

describe('TranscriptStore', () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it('keeps only the newest transcripts, readable by the owner alone, and leaves other files', () => {
    const runsDir = path.join(root, 'runs');
    const store = new TranscriptStore({ record: true, runsDir, keep: 2 });

    store.save(transcript('2026-10-18T09:00:00.000Z'));
    writeFileSync(path.join(runsDir, 'notes.txt'), 'mine');
    store.save(transcript('2026-10-18T09:01:00.000Z'));
    const newest = store.save(transcript('2026-10-18T09:02:00.000Z'));
    const kept = readdirSync(runsDir).sort();

    assert.equal(kept.length, 3);
    assert.ok(kept.includes('notes.txt'));
    assert.equal(kept.filter((name) => name.startsWith('2026-10-18T09-00')).length, 0);
    assert.equal(statSync(newest).mode & 0o777, 0o600);
    assert.equal(statSync(runsDir).mode & 0o777, 0o700);
    assert.equal(store.read(newest).meta.recordedAt, '2026-10-18T09:02:00.000Z');
  });

  it('says when there is no transcript to read', () => {
    assert.throws(
      () =>
        new TranscriptStore({ record: true, runsDir: root, keep: 1 }).read(
          path.join(root, 'none.json'),
        ),
      (error: unknown) =>
        error instanceof TranscriptError && error.errorCode === TranscriptErrorCode.NotFound,
    );
  });
});
