import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { TelemetryOperation } from '@heimdall/telemetry';
import {
  compareTranscripts,
  encodeTranscript,
  ReplayOutcome,
  type ITranscript,
} from '@heimdall/transcript';
import {
  CI_CASES,
  readTranscript,
  replayInProcess,
  transcriptsDir,
} from '../__fixtures__/transcripts/transcript-harness';

const workspace = mkdtempSync(join(os.tmpdir(), 'heimdall-replay-spec-'));
const SMALLEST = join(transcriptsDir(), 'error-burst-30s.json');

/** A copy of a committed transcript with one thing changed, written where a replay can read it. */
function edited(change: (transcript: ITranscript) => ITranscript): {
  file: string;
  transcript: ITranscript;
} {
  const transcript = change(readTranscript(SMALLEST));
  const file = join(workspace, `edited-${Math.random().toString(16).slice(2)}.json`);

  writeFileSync(file, encodeTranscript(transcript));
  return { file, transcript };
}

describe('Replaying the committed CI transcripts (replay-and-evals.md, Replay)', () => {
  after(() => rmSync(workspace, { recursive: true, force: true }));

  for (const { name } of CI_CASES) {
    it(`${name} replays byte for byte, with no model and no backend`, async () => {
      const file = join(transcriptsDir(), `${name}.json`);
      const diff = compareTranscripts(readTranscript(file), await replayInProcess(file), {
        strict: true,
      });

      assert.equal(diff.outcome, ReplayOutcome.Matched, JSON.stringify(diff, null, 2));
      assert.ok(diff.toolResults.compared > 0);
      assert.ok(diff.telemetry.compared > 0);
    });
  }

  it('reports a changed prompt without failing, and fails on it only when strict', async () => {
    const { file, transcript } = edited((recorded) => ({
      ...recorded,
      model: recorded.model.map((exchange) => ({
        ...exchange,
        request: { ...exchange.request, system: `${exchange.request.system ?? ''} (edited)` },
      })),
    }));
    const replayed = await replayInProcess(file);
    const lenient = compareTranscripts(transcript, replayed, { strict: false });

    assert.equal(lenient.outcome, ReplayOutcome.Matched);
    assert.deepEqual(
      lenient.modelInputs.map(({ call, changes }) => [call, changes[0]?.path]),
      transcript.model.map(({ call }) => [call, 'system']),
    );
    assert.equal(
      compareTranscripts(transcript, replayed, { strict: true }).outcome,
      ReplayOutcome.Diverged,
    );
  });

  it('fails when the code turns the same telemetry into different tool results', async () => {
    const { file, transcript } = edited((recorded) => ({
      ...recorded,
      telemetry: recorded.telemetry.map((exchange) =>
        exchange.operation === TelemetryOperation.MetricsQueryRange
          ? {
              ...exchange,
              result: (exchange.result as Array<{ points: Array<{ value: number }> }>).map(
                (series) => ({
                  ...series,
                  points: series.points.map((point) => ({ ...point, value: 0 })),
                }),
              ),
            }
          : exchange,
      ),
    }));
    // The recorded tool results were computed from the original series; these are flat.
    const diff = compareTranscripts(transcript, await replayInProcess(file), { strict: false });

    assert.equal(diff.outcome, ReplayOutcome.Diverged);
    assert.ok(diff.toolResults.differing.length > 0);
    assert.ok(diff.report.length > 0);
  });

  it('names a source call the recording never made', async () => {
    const { file, transcript } = edited((recorded) => ({
      ...recorded,
      telemetry: recorded.telemetry.slice(1),
    }));
    const diff = compareTranscripts(transcript, await replayInProcess(file), { strict: false });

    assert.equal(diff.outcome, ReplayOutcome.Diverged);
    assert.equal(diff.telemetry.extra.length, 1);
    assert.match(diff.telemetry.extra[0] ?? '', /^metrics\.queryRange /);
  });
});
