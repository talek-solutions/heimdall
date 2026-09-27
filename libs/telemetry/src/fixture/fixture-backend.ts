export interface IFixtureRequest {
  readonly method: string;
  /** URL path, still percent-encoded. */
  readonly path: string;
  /** Query string and form body, merged. */
  readonly params: URLSearchParams;
}

export interface IFixtureResponse {
  readonly status: number;
  /** A string goes out as text, anything else as JSON. */
  readonly body: unknown;
}

/** An in-process stand-in for one backend's HTTP API, answering in its wire format. */
export interface IFixtureBackend {
  handle(request: IFixtureRequest): IFixtureResponse;
}

/** A request the real backend would reject with a 400; each backend renders it its own way. */
export class FixtureRequestError extends Error {}
