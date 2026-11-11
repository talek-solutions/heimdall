import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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

  it('writes each transcript whole: no temporary file is left, in the runs directory or beside a replay output', () => {
    const runsDir = path.join(root, 'atomic');
    const store = new TranscriptStore({ record: true, runsDir, keep: 2 });
    const output = path.join(root, 'replayed.json');

    store.save(transcript('2026-10-18T10:00:00.000Z'));
    store.write(output, transcript('2026-10-18T10:01:00.000Z'));

    assert.equal(readdirSync(runsDir).length, 1);
    assert.deepEqual(
      readdirSync(root).filter((name) => name.endsWith('.tmp')),
      [],
    );
    assert.equal(statSync(output).mode & 0o777, 0o600);
  });

  it('sweeps a temporary file a crash left, once it is an hour old, and never takes one for a run', () => {
    const runsDir = path.join(root, 'swept');
    const store = new TranscriptStore({ record: true, runsDir, keep: 5 });
    const stale = path.join(runsDir, '.2026-10-18T08-00-00-000Z-aaaaaa.json.0a1b2c.tmp');
    const fresh = path.join(runsDir, '.2026-10-18T11-59-00-000Z-bbbbbb.json.3d4e5f.tmp');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    mkdirSync(runsDir, { recursive: true });
    writeFileSync(stale, '{"version":');
    writeFileSync(fresh, '{"version":');
    utimesSync(stale, twoHoursAgo, twoHoursAgo);
    const saved = store.save(transcript('2026-10-18T12:00:00.000Z'));

    assert.deepEqual(readdirSync(runsDir).sort(), [path.basename(fresh), path.basename(saved)].sort());
    assert.equal(store.latest(), saved);
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
