import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import type { IConnectorSource } from '../connector-source.type';
import { NO_AUTH_SOURCE, fakeFetch, jsonResponse, type RecordedCall } from '../__fixtures__/fake-fetch.fixture';
import { TelemetryHttpClient } from './telemetry-http.client';

const BEARER_SOURCE: IConnectorSource = {
  url: 'https://backend.example',
  timeoutMs: 1_000,
  auth: { scheme: AuthScheme.Bearer, tokenEnv: 'BACKEND_TOKEN' },
};

function setup(
  respond: (call: RecordedCall) => Response | Promise<Response>,
  source: IConnectorSource = NO_AUTH_SOURCE,
  env: Record<string, string> = {},
): { client: TelemetryHttpClient; calls: RecordedCall[] } {
  const { fetchFn, calls } = fakeFetch(respond);
  const client = new TelemetryHttpClient({ source, lookupEnv: (name) => env[name], fetchFn });
  return { client, calls };
}

async function assertRejectsWith(
  promise: Promise<unknown>,
  code: TelemetryErrorCode,
  messageIncludes?: string,
): Promise<TelemetryError> {
  let caught: unknown;
  await assert.rejects(promise, (error: unknown) => {
    caught = error;
    return true;
  });
  assert.ok(caught instanceof TelemetryError, `expected TelemetryError, got ${String(caught)}`);
  assert.equal(caught.errorCode, code);
  if (messageIncludes !== undefined) {
    assert.ok(caught.message.includes(messageIncludes), `"${caught.message}" lacks "${messageIncludes}"`);
  }
  return caught;
}

describe('TelemetryHttpClient', () => {
  it('GETs with query params, dropping undefined ones, and keeps a base path prefix', async () => {
    const { client, calls } = setup(() => jsonResponse(200, {}), {
      ...NO_AUTH_SOURCE,
      url: 'https://grafana.example/proxy/',
    });

    await client.get({ path: '/api/x', params: { query: '{app="a"}', limit: 5, skipped: undefined } });

    assert.equal(calls[0]?.method, 'GET');
    assert.equal(calls[0]?.url, 'https://grafana.example/proxy/api/x?query=%7Bapp%3D%22a%22%7D&limit=5');
    assert.deepEqual(calls[0]?.headers, { accept: 'application/json' });
  });

  it('POSTs params as a form body', async () => {
    const { client, calls } = setup(() => jsonResponse(200, {}));

    await client.postForm({ path: '/api/v1/query', params: { query: 'up == 0' } });

    assert.equal(calls[0]?.method, 'POST');
    assert.equal(calls[0]?.url, 'https://backend.example/api/v1/query');
    assert.equal(calls[0]?.body, 'query=up+%3D%3D+0');
    assert.equal(calls[0]?.headers['content-type'], 'application/x-www-form-urlencoded');
  });

  it('sends the resolved Authorization header', async () => {
    const { client, calls } = setup(() => jsonResponse(200, {}), BEARER_SOURCE, {
      BACKEND_TOKEN: 'tkn',
    });

    await client.get({ path: '/x' });

    assert.equal(calls[0]?.headers['authorization'], 'Bearer tkn');
  });

  it('fails with MISSING_CREDENTIALS before any request is made', async () => {
    const { client, calls } = setup(() => jsonResponse(200, {}), BEARER_SOURCE);

    await assertRejectsWith(client.get({ path: '/x' }), TelemetryErrorCode.MissingCredentials);
    assert.equal(calls.length, 0);
  });

  it('returns the parsed body on success', async () => {
    const { client } = setup(() => jsonResponse(200, { status: 'success' }));

    assert.deepEqual(await client.get({ path: '/x' }), { status: 'success' });
  });

  it('maps statuses to error codes, keeping the backend reason', async () => {
    const cases: [number, unknown, TelemetryErrorCode, string][] = [
      [401, 'no org id', TelemetryErrorCode.AuthenticationFailed, 'no org id'],
      [403, { message: 'forbidden' }, TelemetryErrorCode.AuthenticationFailed, 'forbidden'],
      [429, 'too many outstanding requests', TelemetryErrorCode.RateLimited, 'too many'],
      [400, { status: 'error', errorType: 'bad_data', error: 'parse error' }, TelemetryErrorCode.QueryRejected, 'bad_data: parse error'],
      [422, { error: 'execution: too many samples' }, TelemetryErrorCode.QueryRejected, 'too many samples'],
      [502, '<html>bad gateway</html>', TelemetryErrorCode.RequestFailed, '502'],
    ];

    for (const [status, body, code, detail] of cases) {
      const { client } = setup(() =>
        typeof body === 'string' ? new Response(body, { status }) : jsonResponse(status, body),
      );
      await assertRejectsWith(client.get({ path: '/x' }), code, detail);
    }
  });

  it('never puts the query string or a credential in an error message', async () => {
    const { client } = setup(() => new Response('denied', { status: 401 }), BEARER_SOURCE, {
      BACKEND_TOKEN: 'super-secret',
    });

    const error = await assertRejectsWith(
      client.get({ path: '/x', params: { query: 'sensitive' } }),
      TelemetryErrorCode.AuthenticationFailed,
    );
    assert.ok(!error.message.includes('super-secret'));
    assert.ok(!error.message.includes('sensitive'));
  });

  it('bounds a long error body', async () => {
    const { client } = setup(() => new Response('x'.repeat(5_000), { status: 500 }));

    const error = await assertRejectsWith(client.get({ path: '/x' }), TelemetryErrorCode.RequestFailed);
    assert.ok(error.message.length < 700);
  });

  it('returns undefined for a 404 from getOptional, but fails for get', async () => {
    const { client } = setup(() => new Response('trace not found', { status: 404 }));

    assert.equal(await client.getOptional({ path: '/x' }), undefined);
    await assertRejectsWith(client.get({ path: '/x' }), TelemetryErrorCode.RequestFailed, '404');
  });

  it('rejects a 2xx non-JSON body with INVALID_RESPONSE', async () => {
    const { client } = setup(() => new Response('not json', { status: 200 }));

    await assertRejectsWith(client.get({ path: '/x' }), TelemetryErrorCode.InvalidResponse);
  });

  it('wraps a thrown fetch in NETWORK_ERROR and keeps the cause', async () => {
    const cause = new Error('ECONNREFUSED');
    const { client } = setup(() => {
      throw cause;
    });

    const error = await assertRejectsWith(client.get({ path: '/x' }), TelemetryErrorCode.NetworkError);
    assert.equal(error.cause, cause);
  });

  it('fails with TIMEOUT once timeoutMs elapses', async () => {
    const { client } = setup(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () => reject(call.signal?.reason));
        }),
      { ...NO_AUTH_SOURCE, timeoutMs: 10 },
    );

    await assertRejectsWith(client.get({ path: '/x' }), TelemetryErrorCode.Timeout, '10ms');
  });

  it('honours a caller abort signal as a NETWORK_ERROR, not a timeout', async () => {
    const controller = new AbortController();
    const { client } = setup((call) => {
      controller.abort();
      return Promise.reject(call.signal?.reason);
    });

    await assertRejectsWith(
      client.get({ path: '/x', signal: controller.signal }),
      TelemetryErrorCode.NetworkError,
    );
  });
});
