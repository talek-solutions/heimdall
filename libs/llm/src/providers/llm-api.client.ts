export interface LlmApiClientConfig {
    apiUrl: string;
}

export interface LlmApiRequestOptions {
    path: string;
    headers?: Record<string, string>;
    body?: Record<string, string>;
    query?: Record<string, string>;
}

class LlmApiClient {
    private readonly apiUrl: string;

    constructor(apiClientConfig: LlmApiClientConfig) {
        this.apiUrl = apiClientConfig.apiUrl;
    }

    public async post<TResponse = unknown, TError = {
        error: Record<string, unknown>
    }>(options: LlmApiRequestOptions): Promise<TResponse | TError> {
        const headers = this.transformDefaultHeaders(options.headers);
        let contentType: string | undefined;
        if (headers) {
            contentType = headers['content-type'];
        }

        try {
            const url = new URL(options.path, this.apiUrl);
            const response = await fetch(url.toString(), {
                method: 'POST',
                headers,
                body: this.transformRequestBody(options?.body, contentType)
            });

            const json = await response.json();

            return json as TResponse;
        } catch (error) {
            return {
                error: {
                    message: "Unable to parse JSON",
                }
            } as TError;
        }
    }

    private transformDefaultHeaders(headers?: Record<string, string>) {
        const headerKeys = Object.keys(headers ?? {});
        if (headerKeys.length > 0) {
            if (!headerKeys
                .map(h => h.toLowerCase())
                .includes('content-type')
            ) {
                return {
                    ...headers,
                    'content-type': 'application/json'
                }
            }
            return headers ?? {};
        }

        return {
            'content-type': 'application/json',
        }
    }

    private transformRequestBody(
        body?: Record<string, string>,
        contentType?: string
    ): string | null {
        if (!body) {
            return null;
        }

        switch (contentType) {
            case 'application/json':
                return JSON.stringify(body);
            default:
                return JSON.stringify(body);
        }
    }
}