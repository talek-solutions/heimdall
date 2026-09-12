import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthScheme, FieldSemantic, Scrubber, SignalType, TelemetryBackend } from '../domain/enums';
import { ConfigError, ConfigErrorCode } from '../domain/errors';
import { parseConfig } from './config.parser';

const VALID = `
version: 1
backends:
  - name: prod-loki
    type: loki
    url: https://loki.example
queries:
  - name: service-errors
    backend: prod-loki
    signal: logs
    query: '{app="x"} |= "error"'
    description: Error logs for one service
    fields:
      app: service
      msg: message
`;

function expectCode(source: string, code: ConfigErrorCode): void {
  assert.throws(
    () => parseConfig(source),
    (error: unknown) => error instanceof ConfigError && error.errorCode === code,
  );
}

describe('parseConfig', () => {
  it('parses a valid config', () => {
    const config = parseConfig(VALID);

    assert.equal(config.backends[0]?.type, TelemetryBackend.Loki);
    assert.equal(config.queries[0]?.signal, SignalType.Logs);
    assert.equal(config.queries[0]?.fields['app'], FieldSemantic.Service);
  });

  it('defaults auth to none so an unauthenticated backend needs no ceremony', () => {
    assert.equal(parseConfig(VALID).backends[0]?.auth.scheme, AuthScheme.None);
  });

  it('enables every scrubber by default, so opting out must be deliberate', () => {
    const { scrubbers } = parseConfig(VALID).redaction;

    for (const scrubber of Object.values(Scrubber)) {
      assert.ok(scrubbers.includes(scrubber), `missing default scrubber ${scrubber}`);
    }
  });

  it('preserves the native query string verbatim', () => {
    // ADR 0005: Heimdall never parses or rewrites the backend's own query language.
    assert.equal(parseConfig(VALID).queries[0]?.query, '{app="x"} |= "error"');
  });

  it('reports malformed YAML distinctly from invalid content', () => {
    expectCode('backends: [unclosed\n', ConfigErrorCode.ConfigParseFailed);
  });

  it('rejects a future config version with a dedicated code', () => {
    // Checked before schema validation so the message is the actual problem
    // rather than an avalanche of downstream field errors.
    expectCode(VALID.replace('version: 1', 'version: 2'), ConfigErrorCode.ConfigUnsupportedVersion);
  });

  it('rejects a query referencing an undeclared backend', () => {
    expectCode(VALID.replace('backend: prod-loki', 'backend: typo'), ConfigErrorCode.ConfigInvalid);
  });

  it('rejects duplicate backend names', () => {
    const duplicated = VALID.replace(
      'queries:',
      '  - name: prod-loki\n    type: loki\n    url: https://other.example\nqueries:',
    );
    expectCode(duplicated, ConfigErrorCode.ConfigInvalid);
  });

  it('rejects a secret pasted where an env var NAME belongs', () => {
    // The config file is committed, so it must be structurally unable to hold a
    // credential (ADR 0008).
    const withSecret = VALID.replace(
      '    url: https://loki.example',
      '    url: https://loki.example\n    auth:\n      scheme: bearer\n      tokenEnv: eyJhbGciOiJIUzI1NiJ9.secret',
    );
    expectCode(withSecret, ConfigErrorCode.ConfigInvalid);
  });

  it('accepts a proper env var name for bearer auth', () => {
    const withEnvName = VALID.replace(
      '    url: https://loki.example',
      '    url: https://loki.example\n    auth:\n      scheme: bearer\n      tokenEnv: LOKI_TOKEN',
    );
    assert.equal(parseConfig(withEnvName).backends[0]?.auth.scheme, AuthScheme.Bearer);
  });

  it('rejects a config with no queries', () => {
    expectCode(VALID.split('queries:')[0] + 'queries: []\n', ConfigErrorCode.ConfigInvalid);
  });

  it('rejects a non-mapping document', () => {
    expectCode('- just\n- a\n- list\n', ConfigErrorCode.ConfigInvalid);
  });
});
