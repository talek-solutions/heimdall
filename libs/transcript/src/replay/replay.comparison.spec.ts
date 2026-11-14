import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TelemetryOperation } from '@heimdall/telemetry';
import type { ITelemetryExchange, ITranscript } from '../format/transcript.interface';
import { ReplayOutcome, TranscriptVersion } from '../transcript.enums';
import { compareTranscripts } from './replay.comparison';

const QUERY = { query: 'up', start: '2026-10-17T07:00:00.000Z' };

function call(resultIds?: readonly string[], request = QUERY): ITelemetryExchange {
  return {
    operation: TelemetryOperation.MetricsQueryRange,
    source: 'http://prometheus.example',
    request,
    result: [],
    ...(resultIds === undefined ? {} : { resultIds }),
  };
}

function transcript(telemetry: readonly ITelemetryExchange[]): ITranscript {
  return {
    version: TranscriptVersion.V1,
    meta: {
      heimdall: '0.0.0',
      recordedAt: '2026-10-18T09:12:04.311Z',
      command: { query: 'checkouts are not working', planOnly: false },
      manifest: { sha256: 'x', content: '' },
      datasources: {},
    },
    environment: { variables: {} },
    pins: {},
    model: [],
    telemetry,
    outcome: { events: [] },
  };
}

function compare(
  recorded: readonly ITelemetryExchange[],
  replayed: readonly ITelemetryExchange[],
) {
  return compareTranscripts(transcript(recorded), transcript(replayed), { strict: true });
}

describe('Replay compares the results a source call served (ADR 0020)', () => {
  it('matches when every call serves the results it served in the recording, in any order', () => {
    const diff = compare([call(['r1']), call(['r2'])], [call(['r2']), call(['r1'])]);

    assert.equal(diff.outcome, ReplayOutcome.Matched);
    assert.deepEqual(diff.telemetry.relinked, []);
  });

  it('diverges when a call is made again for another result, and names the call', () => {
    const diff = compare([call(['r1']), call(['r2'])], [call(['r1']), call(['r3'])]);

    assert.equal(diff.outcome, ReplayOutcome.Diverged);
    assert.deepEqual(diff.telemetry.relinked, ['metrics.queryRange up served r2']);
    assert.deepEqual(diff.telemetry.missing, []);
    assert.deepEqual(diff.telemetry.extra, []);
  });

  it('diverges when the replay stops saying which result a call served', () => {
    const diff = compare([call(['r1'])], [call()]);

    assert.equal(diff.outcome, ReplayOutcome.Diverged);
    assert.equal(diff.telemetry.relinked.length, 1);
  });

  it('has nothing to compare for a call recorded before the link', () => {
    const diff = compare([call(), call()], [call(['r1']), call(['r2'])]);

    assert.equal(diff.outcome, ReplayOutcome.Matched);
    assert.deepEqual(diff.telemetry.relinked, []);
  });

  it('reports a call the replay never made as missing, not as relinked', () => {
    const other = { query: 'down', start: QUERY.start };
    const diff = compare([call(['r1']), call(['r2'], other)], [call(['r1'])]);

    assert.equal(diff.outcome, ReplayOutcome.Diverged);
    assert.deepEqual(diff.telemetry.missing, ['metrics.queryRange down']);
    assert.deepEqual(diff.telemetry.relinked, []);
  });
});
