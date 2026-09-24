import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ConfigEnvVariable } from './enums';
import { defaultConfigPath, resolveConfigPath } from './config.paths';

const HOME = '/Users/someone';

describe('resolveConfigPath', () => {
  it('falls back to ~/.heimdall/config.yaml', () => {
    assert.equal(resolveConfigPath({}, HOME), '/Users/someone/.heimdall/config.yaml');
    assert.equal(resolveConfigPath({}, HOME), defaultConfigPath(HOME));
  });

  it('prefers HEIMDALL_CONFIG over the default', () => {
    const env = { [ConfigEnvVariable.ConfigPath]: '/etc/heimdall.yaml' };
    assert.equal(resolveConfigPath(env, HOME), '/etc/heimdall.yaml');
  });

  it('makes a relative HEIMDALL_CONFIG absolute', () => {
    const env = { [ConfigEnvVariable.ConfigPath]: './local.yaml' };
    assert.equal(resolveConfigPath(env, HOME), path.resolve('./local.yaml'));
  });

  it('treats an empty HEIMDALL_CONFIG as unset', () => {
    const env = { [ConfigEnvVariable.ConfigPath]: '' };
    assert.equal(resolveConfigPath(env, HOME), defaultConfigPath(HOME));
  });
});
