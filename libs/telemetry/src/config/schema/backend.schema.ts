import { z } from 'zod';
import { AuthScheme, TelemetryBackend } from '../../domain/enums';

/**
 * An environment variable NAME, never a value.
 *
 * The config file is committed to a repository, so it must be structurally unable
 * to hold a credential. Auth is expressed as the name of an env var to read at
 * runtime; a schema that accepted a token string would invite exactly the mistake
 * this project cannot afford (ADR 0008).
 */
const environmentVariableName = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'must be an environment variable NAME (e.g. LOKI_TOKEN), never a secret value',
  );

export const authSchema = z.discriminatedUnion('scheme', [
  z.object({ scheme: z.literal(AuthScheme.None) }),
  z.object({
    scheme: z.literal(AuthScheme.Bearer),
    tokenEnv: environmentVariableName,
  }),
  z.object({
    scheme: z.literal(AuthScheme.Basic),
    usernameEnv: environmentVariableName,
    passwordEnv: environmentVariableName,
  }),
]);

export const backendSchema = z.object({
  name: z.string().min(1),
  type: z.enum(TelemetryBackend),
  url: z.url(),
  auth: authSchema.default({ scheme: AuthScheme.None }),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
});

export type BackendConfig = z.infer<typeof backendSchema>;
