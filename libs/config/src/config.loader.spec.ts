import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthScheme, Scrubber, SignalType, TelemetryBackend } from '@heimdall/telemetry';
import { ConfigError, ConfigErrorCode } from './errors';
import { ConfigLoader } from './config.loader';
import { ConfigV1Parser } from './parsers/v1/config-v1.parser';
import { DEFAULT_CONFIG_YAML } from './default-config';

const loader = new ConfigLoader(new ConfigV1Parser());
const parseConfig = (source: string) => loader.parse(source);

const VALID = `
version: 1
kind: Config
currentContext: prod
sources:
  - alias: prod-loki
    type: loki
    url: https://loki.example
    metadata:
      description: Production logs
      labels:
        env: prod
        example.com/team: payments
      annotations:
        owner: sre@example.com
  - alias: prod-grafana
    type: grafana
    url: https://grafana.example
    datasourceUid: P8E80F9AEF21F6940
    signal: traces
contexts:
  - name: prod
    sources: [prod-loki, prod-grafana]
`;

async function expectCode(source: string, code: ConfigErrorCode): Promise<void> {
  await assert.rejects(
    parseConfig(source),
    (error: unknown) => error instanceof ConfigError && error.errorCode === code,
  );
}

describe('ConfigLoader.parse (v1)', () => {
  it('parses a valid config', async () => {
    const config = await parseConfig(VALID);

    assert.equal(config.currentContext, 'prod');
    assert.equal(config.sources[0]?.type, TelemetryBackend.Loki);
    assert.deepEqual(config.contexts[0]?.sources, ['prod-loki', 'prod-grafana']);
  });

  it('keeps source metadata', async () => {
    const metadata = (await parseConfig(VALID)).sources[0]?.metadata;

    assert.equal(metadata?.description, 'Production logs');
    assert.equal(metadata?.labels['example.com/team'], 'payments');
    assert.equal(metadata?.annotations['owner'], 'sre@example.com');
  });

  it('defaults metadata to empty labels and annotations', async () => {
    const metadata = (await parseConfig(VALID)).contexts[0]?.metadata;

    assert.deepEqual(metadata?.labels, {});
    assert.deepEqual(metadata?.annotations, {});
    assert.equal(metadata?.description, undefined);
  });

  it('parses a grafana source with its proxied datasource', async () => {
    const grafana = (await parseConfig(VALID)).sources[1];

    assert.equal(grafana?.type, TelemetryBackend.Grafana);
    if (grafana?.type === TelemetryBackend.Grafana) {
      assert.equal(grafana.datasourceUid, 'P8E80F9AEF21F6940');
      assert.equal(grafana.signal, SignalType.Traces);
    }
  });

  it('rejects a grafana source without a datasource uid', async () => {
    await expectCode(
      VALID.replace('    datasourceUid: P8E80F9AEF21F6940\n', ''),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects a grafana source without a signal', async () => {
    await expectCode(VALID.replace('    signal: traces\n', ''), ConfigErrorCode.ConfigInvalid);
  });

  it('accepts the generated default config', async () => {
    const config = await parseConfig(DEFAULT_CONFIG_YAML);

    assert.equal(config.currentContext, null);
    assert.deepEqual(config.sources, []);
    assert.deepEqual(config.contexts, []);
  });

  it('defaults auth to none so an unauthenticated source needs no ceremony', async () => {
    assert.equal((await parseConfig(VALID)).sources[0]?.auth.scheme, AuthScheme.None);
  });

  it('enables every scrubber by default, so opting out must be deliberate', async () => {
    const { scrubbers } = (await parseConfig(VALID)).redaction;

    for (const scrubber of Object.values(Scrubber)) {
      assert.ok(scrubbers.includes(scrubber), `missing default scrubber ${scrubber}`);
    }
  });

  it('reports malformed YAML distinctly from invalid content', async () => {
    await expectCode('sources: [unclosed\n', ConfigErrorCode.ConfigParseFailed);
  });

  it('rejects a future config version with a dedicated code', async () => {
    // Checked before schema validation so the message is the actual problem
    // rather than an avalanche of downstream field errors.
    await expectCode(
      VALID.replace('version: 1', 'version: 2'),
      ConfigErrorCode.ConfigUnsupportedVersion,
    );
  });

  it('rejects a config without a version', async () => {
    await expectCode(VALID.replace('version: 1\n', ''), ConfigErrorCode.ConfigInvalid);
  });

  it('rejects an unknown kind', async () => {
    await expectCode(VALID.replace('kind: Config', 'kind: Pod'), ConfigErrorCode.ConfigInvalid);
  });

  it('rejects an unknown key inside a source', async () => {
    await expectCode(
      VALID.replace('    signal: traces', '    signal: traces\n    datasourceUID: typo'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects an unknown source type with a readable message', async () => {
    await assert.rejects(
      parseConfig(VALID.replace('type: loki', 'type: splunk')),
      (error: unknown) =>
        error instanceof ConfigError && /sources\.0\.type: type must be one of/.test(error.message),
    );
  });

  it('rejects a misspelt top-level key instead of ignoring it', async () => {
    await expectCode(
      VALID.replace('sources:\n  - alias: prod-loki', 'source:\n  - alias: prod-loki'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects a context referencing an undeclared source', async () => {
    await expectCode(
      VALID.replace('[prod-loki, prod-grafana]', '[prod-loki, typo]'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects a context listing the same source twice', async () => {
    await expectCode(
      VALID.replace('[prod-loki, prod-grafana]', '[prod-loki, prod-loki]'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects a currentContext that is not declared', async () => {
    await expectCode(
      VALID.replace('currentContext: prod', 'currentContext: staging'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects duplicate source aliases', async () => {
    await expectCode(
      VALID.replace('alias: prod-grafana', 'alias: prod-loki'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects duplicate context names', async () => {
    const duplicated = `${VALID}  - name: prod\n    sources: [prod-loki]\n`;
    await expectCode(duplicated, ConfigErrorCode.ConfigInvalid);
  });

  it('rejects an alias that is not a lowercase resource name', async () => {
    await expectCode(
      VALID.replace('alias: prod-loki', 'alias: Prod Loki'),
      ConfigErrorCode.ConfigInvalid,
    );
  });

  it('rejects an invalid label key', async () => {
    await expectCode(VALID.replace('env: prod', '"bad key!": prod'), ConfigErrorCode.ConfigInvalid);
  });

  it('rejects a secret pasted where an env var NAME belongs', async () => {
    // The config file must be structurally unable to hold a credential (ADR 0008).
    const withSecret = VALID.replace(
      '    url: https://loki.example',
      '    url: https://loki.example\n    auth:\n      scheme: bearer\n      tokenEnv: eyJhbGciOiJIUzI1NiJ9.secret',
    );
    await expectCode(withSecret, ConfigErrorCode.ConfigInvalid);
  });

  it('accepts a proper env var name for bearer auth', async () => {
    const withEnvName = VALID.replace(
      '    url: https://loki.example',
      '    url: https://loki.example\n    auth:\n      scheme: bearer\n      tokenEnv: LOKI_TOKEN',
    );
    assert.equal((await parseConfig(withEnvName)).sources[0]?.auth.scheme, AuthScheme.Bearer);
  });

  it('rejects a non-mapping document', async () => {
    await expectCode('- just\n- a\n- list\n', ConfigErrorCode.ConfigInvalid);
  });
});
