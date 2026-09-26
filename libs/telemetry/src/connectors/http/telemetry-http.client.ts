import { HttpStatus } from '@nestjs/common';
import { TelemetryError, TelemetryErrorCode } from '../../errors';
import { resolveAuthHeader, type EnvLookup } from '../auth-header.resolver';
import type { IConnectorSource } from '../connector-source.type';

export interface TelemetryHttpClientConfig {
  readonly source: IConnectorSource;
  readonly lookupEnv: EnvLookup;
  readonly fetchFn?: typeof fetch;
}

/** `undefined` values are dropped, so optional request fields need no branching. */
export type QueryParams = Readonly<Record<string, string | number | undefined>>;

export interface TelemetryRequestOptions {
  readonly path: string;
  readonly params?: QueryParams;
  readonly signal?: AbortSignal;
}

enum HttpMethod {
  Get = 'GET',
  Post = 'POST',
}

enum HttpHeader {
  Accept = 'accept',
  Authorization = 'authorization',
  ContentType = 'content-type',
}

enum MediaType {
  Json = 'application/json',
  Form = 'application/x-www-form-urlencoded',
}

interface Exchange {
  /** `METHOD base/path`, without the query string, for error messages. */
  readonly target: string;
  readonly status: number;
  readonly ok: boolean;
  readonly text: string;
}

const MAX_ERROR_DETAIL_LENGTH = 500;

/**
 * Read-only JSON over native `fetch` (ADR 0003), bounded by the source's
 * `timeoutMs`. Every failure is a thrown `TelemetryError`.
 */
export class TelemetryHttpClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: TelemetryHttpClientConfig) {
    // Not `new URL(path, base)`: that drops a path prefix such as a proxy mount.
    this.baseUrl = config.source.url.replace(/\/+$/, '');
    this.fetchFn = config.fetchFn ?? ((input, init) => fetch(input, init));
  }

  public async get<TBody>(options: TelemetryRequestOptions): Promise<TBody> {
    const exchange = await this.exchange(HttpMethod.Get, options);
    return this.parse<TBody>(this.assertOk(exchange));
  }

  /** Like `get`, but a 404 is an answer (`undefined`), not a failure. */
  public async getOptional<TBody>(options: TelemetryRequestOptions): Promise<TBody | undefined> {
    const exchange = await this.exchange(HttpMethod.Get, options);

    if (exchange.status === HttpStatus.NOT_FOUND) {
      return undefined;
    }
    return this.parse<TBody>(this.assertOk(exchange));
  }

  /** Params go in a form body, keeping long queries clear of URL length limits. */
  public async postForm<TBody>(options: TelemetryRequestOptions): Promise<TBody> {
    const exchange = await this.exchange(HttpMethod.Post, options);
    return this.parse<TBody>(this.assertOk(exchange));
  }

  private async exchange(method: HttpMethod, options: TelemetryRequestOptions): Promise<Exchange> {
    const endpoint = `${this.baseUrl}${options.path}`;
    const target = `${method} ${endpoint}`;
    const params = this.toSearchParams(options.params);
    const isGet = method === HttpMethod.Get;
    const url = isGet && params.size > 0 ? `${endpoint}?${params.toString()}` : endpoint;
    // Resolved before any I/O, so missing credentials never reach the network.
    const headers = this.headers(isGet);
    const timeout = AbortSignal.timeout(this.config.source.timeoutMs);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);

    try {
      const response = await this.fetchFn(url, {
        method,
        headers,
        signal,
        ...(isGet ? {} : { body: params.toString() }),
      });
      // Read inside the try: the timeout also covers a stalled body.
      return { target, status: response.status, ok: response.ok, text: await response.text() };
    } catch (error) {
      if (timeout.aborted) {
        throw new TelemetryError(
          TelemetryErrorCode.Timeout,
          `${target} did not complete within ${this.config.source.timeoutMs}ms`,
          { cause: error },
        );
      }
      throw new TelemetryError(
        TelemetryErrorCode.NetworkError,
        `${target} failed before a response was received`,
        { cause: error },
      );
    }
  }

  private headers(isGet: boolean): Record<string, string> {
    const authorization = resolveAuthHeader(this.config.source.auth, this.config.lookupEnv);

    return {
      [HttpHeader.Accept]: MediaType.Json,
      ...(isGet ? {} : { [HttpHeader.ContentType]: MediaType.Form }),
      ...(authorization === undefined ? {} : { [HttpHeader.Authorization]: authorization }),
    };
  }

  private toSearchParams(params: QueryParams | undefined): URLSearchParams {
    const search = new URLSearchParams();

    for (const [name, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        search.append(name, String(value));
      }
    }
    return search;
  }

  private assertOk(exchange: Exchange): Exchange {
    if (exchange.ok) {
      return exchange;
    }
    const detail = this.readErrorDetail(exchange.text);
    const suffix = detail === undefined ? '' : `: ${detail}`;
    const message = `${exchange.target} returned ${exchange.status}${suffix}`;

    switch (exchange.status) {
      case HttpStatus.UNAUTHORIZED:
      case HttpStatus.FORBIDDEN:
        throw new TelemetryError(TelemetryErrorCode.AuthenticationFailed, message);
      case HttpStatus.TOO_MANY_REQUESTS:
        throw new TelemetryError(TelemetryErrorCode.RateLimited, message);
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        throw new TelemetryError(TelemetryErrorCode.QueryRejected, message);
      default:
        throw new TelemetryError(TelemetryErrorCode.RequestFailed, message);
    }
  }

  private parse<TBody>(exchange: Exchange): TBody {
    try {
      return JSON.parse(exchange.text) as TBody;
    } catch (error) {
      throw new TelemetryError(
        TelemetryErrorCode.InvalidResponse,
        `${exchange.target} returned ${exchange.status} with a non-JSON body`,
        { cause: error },
      );
    }
  }

  /**
   * Prometheus and Loki JSON errors: `{ errorType?, error }`; Loki and Tempo
   * also answer with plain text. The backend's reason is what lets a caller fix
   * a rejected query, so it is kept (bounded).
   */
  private readErrorDetail(text: string): string | undefined {
    let detail = text.trim();

    try {
      const body: unknown = JSON.parse(text);
      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        const reason = record['error'] ?? record['message'];
        if (typeof reason === 'string') {
          const errorType = record['errorType'];
          detail = typeof errorType === 'string' ? `${errorType}: ${reason}` : reason;
        }
      }
    } catch {
      // Not JSON: the trimmed text is the detail.
    }
    return detail === '' ? undefined : detail.slice(0, MAX_ERROR_DETAIL_LENGTH);
  }
}
