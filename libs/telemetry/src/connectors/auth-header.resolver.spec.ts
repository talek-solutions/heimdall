import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthScheme } from '@heimdall/config';
import { TelemetryError, TelemetryErrorCode } from '../errors';
import { resolveAuthHeader } from './auth-header.resolver';

const env = (values: Record<string, string>) => (name: string) => values[name];

describe('resolveAuthHeader', () => {
  it('returns no header for scheme none', () => {
    assert.equal(resolveAuthHeader({ scheme: AuthScheme.None }, env({})), undefined);
  });

  it('reads the bearer token from the named variable', () => {
    const header = resolveAuthHeader(
      { scheme: AuthScheme.Bearer, tokenEnv: 'LOKI_TOKEN' },
      env({ LOKI_TOKEN: 'secret-token' }),
    );

    assert.equal(header, 'Bearer secret-token');
  });

  it('encodes basic credentials from the named variables', () => {
    const header = resolveAuthHeader(
      { scheme: AuthScheme.Basic, usernameEnv: 'PROM_USER', passwordEnv: 'PROM_PASSWORD' },
      env({ PROM_USER: 'alice', PROM_PASSWORD: 'p:ss' }),
    );

    assert.equal(header, `Basic ${Buffer.from('alice:p:ss').toString('base64')}`);
  });

  it('rejects an unset or empty variable, naming it but never a value', () => {
    for (const lookup of [env({}), env({ LOKI_TOKEN: '' })]) {
      assert.throws(
        () => resolveAuthHeader({ scheme: AuthScheme.Bearer, tokenEnv: 'LOKI_TOKEN' }, lookup),
        (error: unknown) =>
          error instanceof TelemetryError &&
          error.errorCode === TelemetryErrorCode.MissingCredentials &&
          error.message.includes('LOKI_TOKEN'),
      );
    }
  });

  it('reports the first missing basic variable', () => {
    assert.throws(
      () =>
        resolveAuthHeader(
          { scheme: AuthScheme.Basic, usernameEnv: 'PROM_USER', passwordEnv: 'PROM_PASSWORD' },
          env({ PROM_USER: 'alice' }),
        ),
      (error: unknown) => error instanceof TelemetryError && error.message.includes('PROM_PASSWORD'),
    );
  });
});
