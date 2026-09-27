import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ManifestEnvVariable } from './enums';
import { defaultManifestPath, resolveManifestPath } from './manifest.paths';

const HOME = '/Users/someone';

describe('resolveManifestPath', () => {
  it('falls back to ~/.heimdall/manifest.yaml', () => {
    assert.equal(resolveManifestPath({}, HOME), '/Users/someone/.heimdall/manifest.yaml');
    assert.equal(resolveManifestPath({}, HOME), defaultManifestPath(HOME));
  });

  it('prefers HEIMDALL_MANIFEST over the default', () => {
    const env = { [ManifestEnvVariable.ManifestPath]: '/etc/shop.yaml' };
    assert.equal(resolveManifestPath(env, HOME), '/etc/shop.yaml');
  });

  it('makes a relative HEIMDALL_MANIFEST absolute', () => {
    const env = { [ManifestEnvVariable.ManifestPath]: './shop.yaml' };
    assert.equal(resolveManifestPath(env, HOME), path.resolve('./shop.yaml'));
  });

  it('treats an empty HEIMDALL_MANIFEST as unset', () => {
    const env = { [ManifestEnvVariable.ManifestPath]: '' };
    assert.equal(resolveManifestPath(env, HOME), defaultManifestPath(HOME));
  });
});
