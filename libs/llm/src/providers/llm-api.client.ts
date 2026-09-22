import { LlmError, LlmErrorCode } from '../errors';

export interface LlmApiClientConfig {
    /** Origin plus any path prefix, e.g. `https://proxy.internal/anthropic`. */
    readonly apiUrl: string;
    readonly fetchFn?: typeof fetch;
}

export interface LlmApiRequestOptions {
    readonly path: string;
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
}

const CONTENT_TYPE_HEADER = 'content-type';
const JSON_CONTENT_TYPE = 'application/json';

/** JSON over native `fetch` (ADR 0003). Every failure is a thrown `LlmError`. */
export class LlmApiClient {
    private readonly apiUrl: string;
    private readonly fetchFn: typeof fetch;

    constructor(config: LlmApiClientConfig) {
        // Not `new URL(path, apiUrl)`: that drops a path prefix on the base.
        this.apiUrl = config.apiUrl.replace(/\/+$/, '');
        this.fetchFn = config.fetchFn ?? ((input, init) => fetch(input, init));
    }

    public async post<TResponse>(options: LlmApiRequestOptions): Promise<TResponse> {
        const url = `${this.apiUrl}${options.path}`;
        const headers = this.withDefaultContentType(options.headers);

        let response: Response;
        try {
            response = await this.fetchFn(url, {
                method: 'POST',
                headers,
                ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
                ...(options.signal !== undefined ? { signal: options.signal } : {}),
            });
        } catch (error) {
            throw new LlmError(
                LlmErrorCode.NETWORK_ERROR,
                `POST ${url} failed before a response was received`,
                { cause: error },
            );
        }

        if (!response.ok) {
            throw await this.toStatusError(response, url);
        }

        try {
            return (await response.json()) as TResponse;
        } catch (error) {
            throw new LlmError(
                LlmErrorCode.INVALID_RESPONSE,
                `POST ${url} returned ${response.status} with a non-JSON body`,
                { cause: error },
            );
        }
    }

    private withDefaultContentType(
        headers: Record<string, string> | undefined,
    ): Record<string, string> {
        const hasContentType = Object.keys(headers ?? {}).some(
            (name) => name.toLowerCase() === CONTENT_TYPE_HEADER,
        );
        if (hasContentType) {
            return headers ?? {};
        }
        return { ...headers, [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE };
    }

    private async toStatusError(response: Response, url: string): Promise<LlmError> {
        const body: unknown = await response.json().catch(() => undefined);
        const detail = this.readErrorMessage(body);
        const message = `POST ${url} returned ${response.status}${detail === undefined ? '' : `: ${detail}`}`;

        switch (response.status) {
            case 401:
            case 403:
                return new LlmError(LlmErrorCode.AUTHENTICATION_FAILED, message);
            case 429:
                return new LlmError(LlmErrorCode.RATE_LIMITED, message);
            default:
                return new LlmError(LlmErrorCode.REQUEST_FAILED, message);
        }
    }

    /** Anthropic: `{ error: { message } }`; others commonly top-level `message`. */
    private readErrorMessage(body: unknown): string | undefined {
        if (typeof body !== 'object' || body === null) {
            return undefined;
        }
        const record = body as Record<string, unknown>;
        const nested = record['error'];
        if (typeof nested === 'object' && nested !== null) {
            const nestedMessage = (nested as Record<string, unknown>)['message'];
            if (typeof nestedMessage === 'string') {
                return nestedMessage;
            }
        }
        return typeof record['message'] === 'string' ? record['message'] : undefined;
    }
}
