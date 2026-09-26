import { IsEnum, Matches } from 'class-validator';
import { AuthScheme } from '../enums';

/**
 * An environment variable NAME, never a value.
 *
 * The config file must be structurally unable to hold a credential. Auth is
 * expressed as the name of an env var to read at runtime; a schema that accepted
 * a token string would invite exactly the mistake this project cannot afford
 * (ADR 0008).
 */
const ENVIRONMENT_VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENVIRONMENT_VARIABLE_MESSAGE =
  '$property must be an environment variable NAME (e.g. LOKI_TOKEN), never a secret value';

export class AuthConfigBase<S extends AuthScheme = AuthScheme> {
  @IsEnum(AuthScheme)
  scheme!: S;
}

export class NoAuthConfig extends AuthConfigBase<AuthScheme.None> {
  override scheme = AuthScheme.None as const;
}

export class BearerAuthConfig extends AuthConfigBase<AuthScheme.Bearer> {
  @Matches(ENVIRONMENT_VARIABLE_NAME, { message: ENVIRONMENT_VARIABLE_MESSAGE })
  tokenEnv!: string;
}

export class BasicAuthConfig extends AuthConfigBase<AuthScheme.Basic> {
  @Matches(ENVIRONMENT_VARIABLE_NAME, { message: ENVIRONMENT_VARIABLE_MESSAGE })
  usernameEnv!: string;

  @Matches(ENVIRONMENT_VARIABLE_NAME, { message: ENVIRONMENT_VARIABLE_MESSAGE })
  passwordEnv!: string;
}

export type AuthConfig = NoAuthConfig | BearerAuthConfig | BasicAuthConfig;

export const AUTH_SUBTYPES = [
  { value: NoAuthConfig, name: AuthScheme.None },
  { value: BearerAuthConfig, name: AuthScheme.Bearer },
  { value: BasicAuthConfig, name: AuthScheme.Basic },
];
