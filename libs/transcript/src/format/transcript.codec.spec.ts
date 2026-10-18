import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TranscriptError, TranscriptErrorCode } from '../errors';
import { TranscriptVersion } from '../transcript.enums';
import { recordedVariables } from './environment';
import { canonical, decodeTranscript, encodeTranscript } from './transcript.codec';
import type { ITranscript } from './transcript.interface';

const EMPTY: ITranscript = {
  version: TranscriptVersion.V1,
  meta: {
    heimdall: '0.0.0',
    recordedAt: '2026-10-18T09:12:04.311Z',
    command: { query: 'checkouts are not working', planOnly: false },
    manifest: { sha256: 'x', content: 'apiVersion: heimdall/v1' },
    datasources: {},
  },
  environment: { variables: {} },
  pins: {},
  model: [],
  telemetry: [],
  outcome: { events: [] },
};

function rejects(text: string, pattern: RegExp): void {
  assert.throws(
    () => decodeTranscript(text, 'run.json'),
    (error: unknown) =>
      error instanceof TranscriptError &&
      error.errorCode === TranscriptErrorCode.Invalid &&
      pattern.test(error.message),
  );
}

describe('The transcript format (replay-and-evals.md, The transcript)', () => {
  it('round-trips the numbers JSON cannot hold', () => {
    const transcript = {
      ...EMPTY,
      pins: { now: { value: [Number.NaN, Infinity, -Infinity, 1.5] } },
    };
    const decoded = decodeTranscript(encodeTranscript(transcript), 'run.json');

    assert.deepEqual(decoded.pins['now']?.value, [Number.NaN, Infinity, -Infinity, 1.5]);
    assert.match(encodeTranscript(transcript), /\{"\$number":"NaN"\}/);
  });

  it('keeps a value that fits on a line on one line, so a changed value is a one-line diff', () => {
    const points = Array.from({ length: 10 }, (_, index) => ({
      timestampMs: index,
      value: index / 10,
    }));
    const text = encodeTranscript({ ...EMPTY, pins: { series: { value: points } } });

    assert.ok(text.includes('\n        {"timestampMs":1,"value":0.1},\n'), text);
  });

  it('refuses what is not a transcript, and a version it cannot read', () => {
    rejects('{not json', /is not JSON/);
    rejects('{"hello":1}', /is not a transcript/);
    rejects(JSON.stringify({ ...EMPTY, version: 2 }), /version 2; this build reads version 1/);
    rejects(JSON.stringify({ ...EMPTY, model: undefined }), /no model or telemetry calls/);
  });

  it('gives equal values equal text, whatever order their keys were built in', () => {
    assert.equal(canonical({ b: 1, a: { d: 2, c: 3 } }), canonical({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('keeps only the variables that shape a run, never a key or a token', () => {
    assert.deepEqual(
      recordedVariables({
        INVESTIGATION_MAX_TURNS: '8',
        AGENT_TIMEOUT_SECONDS: '60',
        LOKI_DATASOURCE_TYPE: 'fixture',
        TELEMETRY_FIXTURE_SCENARIO: 'error-burst-30s',
        ANTHROPIC_API_KEY: 'sk-ant-planted',
        LOKI_TOKEN: 'planted',
        AGENT_API_TOKEN: 'planted',
        INVESTIGATION_LOOKBACK: '',
        HOME: '/Users/someone',
      }),
      {
        AGENT_TIMEOUT_SECONDS: '60',
        INVESTIGATION_MAX_TURNS: '8',
        LOKI_DATASOURCE_TYPE: 'fixture',
        TELEMETRY_FIXTURE_SCENARIO: 'error-burst-30s',
      },
    );
  });
});
