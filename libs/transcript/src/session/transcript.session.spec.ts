import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  LlmError,
  LlmErrorCode,
  LLMFinishReason,
  LLMMessageRole,
  type ILLMProviderMessageResponse,
} from '@heimdall/llm';
import { TelemetryOperation } from '@heimdall/telemetry';
import { ReplayedError, TranscriptError, TranscriptErrorCode } from '../errors';
import { TranscriptStore } from '../store/transcript.store';
import { TranscriptMode, TranscriptPin } from '../transcript.enums';
import { TranscriptSession } from './transcript.session';

const root = mkdtempSync(path.join(os.tmpdir(), 'heimdall-session-'));
const COMMIT = '2e3ef8e0c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a6';
const BEGIN = {
  heimdall: '0.0.0',
  commit: COMMIT,
  dirty: false,
  command: { query: 'checkouts are not working', planOnly: false },
  manifest: 'apiVersion: heimdall/v1',
  datasources: {},
  env: { INVESTIGATION_MAX_TURNS: '8', ANTHROPIC_API_KEY: 'sk-ant-planted' },
};
const CALL = {
  operation: TelemetryOperation.MetricsQueryRange,
  source: 'http://prometheus.example',
  request: { query: 'up', start: '2026-10-17T07:00:00.000Z' },
};

function recorder(name: string): { session: TranscriptSession; store: TranscriptStore } {
  const config = { record: true, runsDir: path.join(root, name), keep: 5 };
  const store = new TranscriptStore(config);
  return { session: new TranscriptSession(config, store), store };
}

function replayer(from: string): TranscriptSession {
  const config = {
    record: true,
    runsDir: root,
    keep: 5,
    replay: { from, output: path.join(root, `replayed-${path.basename(from)}`) },
  };
  return new TranscriptSession(config, new TranscriptStore(config));
}

function request(text: string) {
  return { model: 'm', messages: [{ role: LLMMessageRole.USER, content: text }] };
}

const response: ILLMProviderMessageResponse = {
  id: 'msg_1',
  model: 'm',
  role: LLMMessageRole.ASSISTANT,
  content: [],
  finishReason: LLMFinishReason.STOP,
  usage: { inputTokens: 1, outputTokens: 1 },
  raw: { provider: 'secret-ish' },
};

describe('TranscriptSession', () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it('passes everything through untouched until a run begins', async () => {
    const { session } = recorder('idle');

    assert.equal(await session.intercept(CALL, async () => 42), 42);
    assert.deepEqual(session.finish({}), {});
  });

  it('records what was sent, as it was then, without raw provider responses or secrets', async () => {
    const { session, store } = recorder('record');
    const sent = request('first');

    session.begin(BEGIN);
    await session.chat(sent, async () => ({ ...response, content: [] }));
    sent.messages.push({ role: LLMMessageRole.USER, content: 'appended later' });
    await assert.rejects(
      session.intercept(CALL, async () => {
        throw new LlmError(LlmErrorCode.RATE_LIMITED, 'slow down');
      }),
    );
    const { path: file } = session.finish({ error: { errorCode: 'X' } });
    const transcript = store.read(file ?? '');

    assert.equal(session.mode, TranscriptMode.Record);
    assert.equal(transcript.model[0]?.request.messages.length, 1);
    assert.equal('raw' in (transcript.model[0]?.response ?? {}), false);
    assert.deepEqual(transcript.telemetry[0]?.error, {
      errorCode: 'LLM_RATE_LIMITED',
      message: 'slow down',
    });
    assert.deepEqual(transcript.environment.variables, { INVESTIGATION_MAX_TURNS: '8' });
  });

  it('names the run and the code that made it, and a replay is a run of its own (ADR 0019, ADR 0022)', async () => {
    const { session, store } = recorder('identity');

    session.begin({ ...BEGIN, dirty: true });
    const { path: file = '' } = session.finish({});
    const recorded = store.read(file);
    const clean = recorder('identity-clean');
    const outside = recorder('identity-outside');

    clean.session.begin(BEGIN);
    outside.session.begin({ ...BEGIN, commit: null });
    const replay = replayer(file);

    replay.begin(BEGIN);
    const replayed = store.read(replay.finish({}).path ?? '');

    assert.match(recorded.meta.runId ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(recorded.meta.commit, COMMIT);
    assert.equal(recorded.meta.dirty, true);
    assert.equal('dirty' in clean.store.read(clean.session.finish({}).path ?? '').meta, false);
    assert.equal(outside.store.read(outside.session.finish({}).path ?? '').meta.commit, null);
    assert.match(replayed.meta.runId ?? '', /^[0-9a-f-]{36}$/);
    assert.notEqual(replayed.meta.runId, recorded.meta.runId);
  });

  it('records the results a source call served, when it fails too (ADR 0020)', async () => {
    const { session, store } = recorder('linked');

    session.begin(BEGIN);
    await session.intercept({ ...CALL, resultIds: ['r3'] }, async () => [1]);
    await assert.rejects(
      session.intercept({ ...CALL, source: 'http://loki.example', resultIds: ['r4'] }, async () => {
        throw new LlmError(LlmErrorCode.RATE_LIMITED, 'slow down');
      }),
    );
    await session.intercept({ ...CALL, source: 'http://tempo.example' }, async () => [2]);
    const { telemetry } = store.read(session.finish({}).path ?? '');
    const served = Object.fromEntries(
      telemetry.map(({ source, resultIds }) => [source, resultIds]),
    );

    assert.deepEqual(served, {
      'http://prometheus.example': ['r3'],
      'http://loki.example': ['r4'],
      'http://tempo.example': undefined,
    });
    assert.equal(telemetry.find(({ source }) => source.includes('loki'))?.error?.errorCode, 'LLM_RATE_LIMITED');
  });

  it('writes two calls with the same request in the same order, whichever finished first', async () => {
    const text = async (name: string, order: readonly string[]): Promise<string> => {
      const { session, store } = recorder(name);

      session.begin(BEGIN);
      for (const result of order) {
        await session.intercept({ ...CALL, resultIds: [result] }, async () => [result]);
      }
      const { path: file = '' } = session.finish({});
      const { telemetry } = store.read(file);

      assert.ok(readFileSync(file, 'utf8').includes('"resultIds"'));
      return JSON.stringify(telemetry);
    };

    assert.equal(await text('tie-forward', ['r2', 'r10']), await text('tie-reverse', ['r10', 'r2']));
  });

  it('answers each of two equal requests with what its own result was served, and tags the replay with the live call', async () => {
    const { session, store } = recorder('own-answers');
    const never = async (): Promise<never> => {
      throw new Error('a replay reached the source');
    };

    session.begin(BEGIN);
    await session.intercept({ ...CALL, resultIds: ['r1'] }, async () => ['for r1']);
    await session.intercept({ ...CALL, resultIds: ['r2'] }, async () => ['for r2']);
    const { path: file = '' } = session.finish({});
    const replay = replayer(file);

    replay.begin(BEGIN);
    // The live run asks in the other order: each call still gets its own recording back.
    assert.deepEqual(await replay.intercept({ ...CALL, resultIds: ['r2'] }, never), ['for r2']);
    assert.deepEqual(await replay.intercept({ ...CALL, resultIds: ['r1'] }, never), ['for r1']);
    const replayed = store.read(replay.finish({}).path ?? '');

    assert.deepEqual(
      replayed.telemetry.map(({ resultIds, result }) => [resultIds, result]),
      [
        [['r1'], ['for r1']],
        [['r2'], ['for r2']],
      ],
    );
  });

  it('replays a recording from before the link, and the replay says what each call served', async () => {
    const { session, store } = recorder('before-link');
    const never = async (): Promise<never> => {
      throw new Error('a replay reached the source');
    };

    session.begin(BEGIN);
    await session.intercept(CALL, async () => ['first']);
    await session.intercept(CALL, async () => ['second']);
    const { path: file = '' } = session.finish({});
    const replay = replayer(file);

    assert.equal(store.read(file).telemetry.every(({ resultIds }) => resultIds === undefined), true);
    replay.begin(BEGIN);
    assert.deepEqual(await replay.intercept({ ...CALL, resultIds: ['r1'] }, never), ['first']);
    assert.deepEqual(await replay.intercept({ ...CALL, resultIds: ['r2'] }, never), ['second']);
    const replayed = store.read(replay.finish({}).path ?? '');

    assert.deepEqual(
      replayed.telemetry.map(({ resultIds }) => resultIds),
      [['r1'], ['r2']],
    );
  });

  it('pins a value, or the error computing it raised, and replays either', async () => {
    const { session, store } = recorder('pins');

    session.begin(BEGIN);
    assert.equal(
      session.pin(TranscriptPin.Now, () => 'first'),
      'first',
    );
    assert.equal(
      session.pin(TranscriptPin.Now, () => 'second'),
      'first',
      'the first value stays',
    );
    assert.throws(() =>
      session.pin(TranscriptPin.Sources, () => {
        throw new ReplayedError('INVESTIGATION_SOURCE_MISSING', 'no prometheus source');
      }),
    );
    const { path: file = '' } = session.finish({});
    const replay = replayer(file);

    replay.begin(BEGIN);
    assert.equal(
      replay.pin(TranscriptPin.Now, () => 'live'),
      'first',
    );
    assert.throws(
      () => replay.pin(TranscriptPin.Sources, () => 'live'),
      (error: unknown) =>
        error instanceof ReplayedError && error.errorCode === 'INVESTIGATION_SOURCE_MISSING',
    );
    assert.throws(
      () => replay.pin(TranscriptPin.EntryChoice, () => 'live'),
      (error: unknown) =>
        error instanceof TranscriptError && error.errorCode === TranscriptErrorCode.ReplayMiss,
    );
    assert.ok(store.read(file).pins['now'] !== undefined);
  });

  it('answers a replay from the recording, and says when the run asks for more', async () => {
    const { session } = recorder('replay');

    session.begin(BEGIN);
    await session.chat(request('first'), async () => response);
    await session.intercept(CALL, async () => [
      { labels: {}, points: [{ timestampMs: 0, value: Number.NaN }] },
    ]);
    const { path: file = '' } = session.finish({});
    const replay = replayer(file);
    const never = async (): Promise<never> => {
      throw new Error('a replay reached the network');
    };

    replay.begin(BEGIN);
    assert.equal((await replay.chat(request('changed'), never)).id, 'msg_1');
    assert.ok(
      Number.isNaN(
        (await replay.intercept<Array<{ points: Array<{ value: number }> }>>(CALL, never))[0]
          ?.points[0]?.value,
      ),
    );
    await assert.rejects(
      replay.chat(request('again'), never),
      (error: unknown) =>
        error instanceof TranscriptError && error.errorCode === TranscriptErrorCode.ReplayExhausted,
    );
    await assert.rejects(
      replay.intercept({ ...CALL, request: { query: 'other' } }, never),
      (error: unknown) =>
        error instanceof TranscriptError && error.errorCode === TranscriptErrorCode.ReplayMiss,
    );
  });
});
