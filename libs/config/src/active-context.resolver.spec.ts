import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { ConfigEnvVariable } from './enums';
import { ConfigError, ConfigErrorCode } from './errors';
import { resolveActiveContext } from './active-context.resolver';
import { ConfigLoader } from './config.loader';
import { ConfigV1Parser } from './parsers/v1/config-v1.parser';
import type { IHeimdallConfig } from './interfaces/heimdall-config.interface';

const SOURCE = `
version: 1
kind: Config
currentContext: prod
sources:
  - { alias: prod-loki, type: loki, url: https://loki.prod }
  - { alias: prod-tempo, type: tempo, url: https://tempo.prod }
  - { alias: staging-loki, type: loki, url: https://loki.staging }
contexts:
  - { name: prod, sources: [prod-tempo, prod-loki] }
  - { name: staging, sources: [staging-loki] }
  - { name: dev, sources: [staging-loki] }
`;

describe('resolveActiveContext', () => {
  let CONFIG: IHeimdallConfig;

  before(async () => {
    CONFIG = await new ConfigLoader(new ConfigV1Parser()).parse(SOURCE);
  });

  it('uses currentContext when nothing overrides it', () => {
    assert.equal(resolveActiveContext(CONFIG, { env: {} })?.name, 'prod');
  });

  it('prefers HEIMDALL_CONTEXT over currentContext', () => {
    const env = { [ConfigEnvVariable.Context]: 'staging' };
    assert.equal(resolveActiveContext(CONFIG, { env })?.name, 'staging');
  });

  it('prefers the flag over HEIMDALL_CONTEXT', () => {
    const env = { [ConfigEnvVariable.Context]: 'staging' };
    assert.equal(resolveActiveContext(CONFIG, { flag: 'dev', env })?.name, 'dev');
  });

  it('treats empty overrides as unset', () => {
    const env = { [ConfigEnvVariable.Context]: '' };
    assert.equal(resolveActiveContext(CONFIG, { flag: '', env })?.name, 'prod');
  });

  it('resolves aliases to sources in the order the context lists them', () => {
    const sources = resolveActiveContext(CONFIG, { env: {} })?.sources ?? [];
    assert.deepEqual(
      sources.map((source) => source.alias),
      ['prod-tempo', 'prod-loki'],
    );
  });

  it('returns undefined when no context is selected', () => {
    assert.equal(resolveActiveContext({ ...CONFIG, currentContext: null }, { env: {} }), undefined);
  });

  it('rejects an unknown context with a dedicated code', () => {
    assert.throws(
      () => resolveActiveContext(CONFIG, { flag: 'typo', env: {} }),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.errorCode === ConfigErrorCode.ConfigContextNotFound &&
        /prod, staging, dev/.test(error.message),
    );
  });
});
