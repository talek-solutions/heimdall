/**
 * The single error shape every Heimdall surface reports, so the CLI and any future
 * HTTP service describe a failure identically.
 */
export interface ErrorResponse {
  readonly errorCode: string;
  readonly message?: string;
}
