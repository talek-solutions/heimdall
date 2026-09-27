import { HttpStatus } from '@nestjs/common';
import type { IFixtureBackend, IFixtureResponse } from './fixture-backend';

enum HttpMethod {
  Get = 'GET',
}

enum ContentType {
  Json = 'application/json',
  Text = 'text/plain; charset=utf-8',
}

/**
 * A `fetch` served by a fixture backend. It plugs into `TelemetryHttpClient`'s
 * `fetchFn`, so status mapping, abort handling and JSON parsing stay the real ones.
 */
export function createFixtureFetch(backend: IFixtureBackend): typeof fetch {
  return async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const params = new URLSearchParams(url.search);

    if (typeof init?.body === 'string') {
      for (const [name, value] of new URLSearchParams(init.body)) {
        params.append(name, value);
      }
    }
    return toResponse(respond(backend, init?.method ?? HttpMethod.Get, url.pathname, params));
  };
}

// A throwing handler is a fixture bug; a 500 names it instead of posing as a network failure.
function respond(
  backend: IFixtureBackend,
  method: string,
  path: string,
  params: URLSearchParams,
): IFixtureResponse {
  try {
    return backend.handle({ method, path, params });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: `fixture: ${reason}` };
  }
}

function toResponse(response: IFixtureResponse): Response {
  const isText = typeof response.body === 'string';

  return new Response(isText ? (response.body as string) : JSON.stringify(response.body), {
    status: response.status,
    headers: { 'content-type': isText ? ContentType.Text : ContentType.Json },
  });
}
