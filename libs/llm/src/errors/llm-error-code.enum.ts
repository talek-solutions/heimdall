/** `LLM_`-prefixed so the CLI can group codes by string value without collisions. */
export enum LlmErrorCode {
    INVALID_PROVIDER = 'LLM_INVALID_PROVIDER',
    MISSING_API_KEY = 'LLM_MISSING_API_KEY',
    /** HTTP 401/403. */
    AUTHENTICATION_FAILED = 'LLM_AUTHENTICATION_FAILED',
    /** HTTP 429. */
    RATE_LIMITED = 'LLM_RATE_LIMITED',
    /** Any other non-2xx. */
    REQUEST_FAILED = 'LLM_REQUEST_FAILED',
    /** No HTTP response at all (DNS, TLS, socket, abort). */
    NETWORK_ERROR = 'LLM_NETWORK_ERROR',
    /** 2xx with a body this lib cannot interpret. */
    INVALID_RESPONSE = 'LLM_INVALID_RESPONSE',
    /** The abstract request asks for something the provider cannot express. */
    UNSUPPORTED_REQUEST = 'LLM_UNSUPPORTED_REQUEST',
}
