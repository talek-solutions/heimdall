import { AuthScheme } from '@heimdall/config';
import type { IConnectorSource } from '../connector-source.type';
import { TelemetryHttpClient } from '../http/telemetry-http.client';

export interface RecordedCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export const NO_AUTH_SOURCE: IConnectorSource = {
  url: 'https://backend.example',
  timeoutMs: 1_000,
  auth: { scheme: AuthScheme.None },
};

export function fakeFetch(respond: (call: RecordedCall) => Response | Promise<Response>): {
  fetchFn: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetchFn, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A client over a fake fetch answering every call with `body` (200 JSON). */
export function clientReturning(
  body: unknown,
  source: IConnectorSource = NO_AUTH_SOURCE,
): { client: TelemetryHttpClient; calls: RecordedCall[] } {
  const { fetchFn, calls } = fakeFetch(() => jsonResponse(200, body));
  const client = new TelemetryHttpClient({ source, lookupEnv: () => undefined, fetchFn });
  return { client, calls };
}

export function queryOf(call: RecordedCall | undefined): URLSearchParams {
  return new URL(call?.url ?? 'http://invalid').searchParams;
}
