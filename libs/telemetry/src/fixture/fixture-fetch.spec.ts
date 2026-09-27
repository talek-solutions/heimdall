import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { TelemetryHttpClient } from '../connectors/http/telemetry-http.client';
import { TelemetryError, TelemetryErrorCode } from '../errors';
import type { IFixtureBackend, IFixtureRequest } from './fixture-backend';
import { createFixtureFetch } from './fixture-fetch';

function recording(respond: IFixtureBackend['handle']): {
  backend: IFixtureBackend;
  requests: IFixtureRequest[];
} {
  const requests: IFixtureRequest[] = [];
  return {
    requests,
    backend: {
      handle: (request) => {
        requests.push(request);
        return respond(request);
      },
    },
  };
}

function client(backend: IFixtureBackend): TelemetryHttpClient {
  return new TelemetryHttpClient({
    source: { url: 'http://prometheus.fixture.invalid', timeoutMs: 1_000, auth: { scheme: AuthScheme.None } },
    lookupEnv: () => undefined,
    fetchFn: createFixtureFetch(backend),
  });
}

describe('createFixtureFetch', () => {
  it('hands the backend the path and the merged query-string and form params', async () => {
    const { backend, requests } = recording(() => ({ status: 200, body: { ok: true } }));

    const body = await client(backend).postForm({ path: '/api/v1/query', params: { query: 'up', time: 5 } });

    assert.deepEqual(body, { ok: true });
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.path, '/api/v1/query');
    assert.equal(requests[0]?.params.get('query'), 'up');
    assert.equal(requests[0]?.params.get('time'), '5');
  });

  it('lets the real client map fixture statuses and text bodies', async () => {
    const { backend } = recording(() => ({ status: 400, body: 'parse error at line 1' }));

    await assert.rejects(
      client(backend).get({ path: '/x' }),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.QueryRejected &&
        error.message.includes('parse error at line 1'),
    );
  });

  it('turns a throwing backend into a 500 that names the fixture', async () => {
    const { backend } = recording(() => {
      throw new Error('boom');
    });

    await assert.rejects(
      client(backend).get({ path: '/x' }),
      (error: unknown) =>
        error instanceof TelemetryError &&
        error.errorCode === TelemetryErrorCode.RequestFailed &&
        error.message.includes('fixture: boom'),
    );
  });

  it('honours a caller abort before generating anything', async () => {
    const { backend, requests } = recording(() => ({ status: 200, body: {} }));

    await assert.rejects(
      client(backend).get({ path: '/x', signal: AbortSignal.abort() }),
      (error: unknown) =>
        error instanceof TelemetryError && error.errorCode === TelemetryErrorCode.NetworkError,
    );
    assert.equal(requests.length, 0);
  });
});
