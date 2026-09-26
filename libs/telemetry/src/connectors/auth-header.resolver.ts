import { AuthScheme, type IAuthConfig } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../errors';

export type EnvLookup = (name: string) => string | undefined;

/**
 * Turns env var NAMES (ADR 0008) into an `Authorization` header value. Called per
 * request, so a missing variable only fails the command that actually queries.
 */
export function resolveAuthHeader(auth: IAuthConfig, lookup: EnvLookup): string | undefined {
  switch (auth.scheme) {
    case AuthScheme.None:
      return undefined;
    case AuthScheme.Bearer:
      return `Bearer ${requireEnv(auth.tokenEnv, lookup)}`;
    case AuthScheme.Basic: {
      const username = requireEnv(auth.usernameEnv, lookup);
      const password = requireEnv(auth.passwordEnv, lookup);
      return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
  }
}

// The message names the variable, never its value.
function requireEnv(name: string, lookup: EnvLookup): string {
  const value = lookup(name);

  if (value === undefined || value === '') {
    throw new TelemetryError(
      TelemetryErrorCode.MissingCredentials,
      `${name} is not set; export it or add it to .env`,
    );
  }
  return value;
}
