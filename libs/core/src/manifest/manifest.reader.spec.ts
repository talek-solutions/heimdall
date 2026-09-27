import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createReader, MINIMAL_MANIFEST, plain } from './__fixtures__/manifest-v1.fixture';
import { ManifestEnvVariable } from './enums';
import { ManifestError, ManifestErrorCode } from './errors';

const reader = createReader();

function rejectsWith(code: ManifestErrorCode, ...fragments: string[]): (error: unknown) => boolean {
  return (error) =>
    error instanceof ManifestError &&
    error.errorCode === code &&
    fragments.every((fragment) => error.message.includes(fragment));
}

describe('ManifestReader.load', () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'heimdall-manifest-'));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads and parses the file', async () => {
    const path = join(directory, 'manifest.yaml');
    await writeFile(path, MINIMAL_MANIFEST);

    assert.equal((await reader.load(path)).components[0]?.metadata.name, 'api');
  });

  it('reports a missing file with a hint about HEIMDALL_MANIFEST', async () => {
    await assert.rejects(
      reader.load(join(directory, 'absent.yaml')),
      rejectsWith(ManifestErrorCode.ManifestFileNotFound, ManifestEnvVariable.ManifestPath),
    );
  });

  it('reports a path that cannot be read as a file', async () => {
    await assert.rejects(
      reader.load(directory),
      rejectsWith(ManifestErrorCode.ManifestFileUnreadable, directory),
    );
  });
});

describe('ManifestReader.parse', () => {
  it('reports malformed YAML distinctly, naming the document', async () => {
    await assert.rejects(
      reader.parse(`${MINIMAL_MANIFEST}---\nspec: [unclosed\n`),
      rejectsWith(ManifestErrorCode.ManifestParseFailed, 'document 3'),
    );
  });

  it('rejects a file with no documents', async () => {
    await assert.rejects(
      reader.parse('# nothing here\n'),
      rejectsWith(ManifestErrorCode.ManifestInvalid, 'no documents'),
    );
  });

  it('rejects a document that is not a mapping', async () => {
    await assert.rejects(
      reader.parse(`${MINIMAL_MANIFEST}---\n- a\n- list\n`),
      rejectsWith(ManifestErrorCode.ManifestInvalid, 'document 3: must be a YAML mapping'),
    );
  });

  it('ignores an empty trailing document', async () => {
    assert.equal((await reader.parse(`${MINIMAL_MANIFEST}---\n`)).components.length, 1);
  });

  it('numbers documents as the author sees them, empty ones included', async () => {
    const withEmptySection = MINIMAL_MANIFEST.replace('---\n', '---\n---\n').replace(
      'type: service',
      'type: server',
    );
    await assert.rejects(
      reader.parse(withEmptySection),
      rejectsWith(ManifestErrorCode.ManifestInvalid, 'document 3 (Component/api)'),
    );
  });

  it('rejects a document without an apiVersion before validating anything else', async () => {
    await assert.rejects(
      reader.parse(
        MINIMAL_MANIFEST.replace('apiVersion: heimdall/v1\nkind: Component', 'kind: Component'),
      ),
      rejectsWith(ManifestErrorCode.ManifestInvalid, 'document 2: apiVersion is required'),
    );
  });

  it('rejects an unsupported apiVersion with a dedicated code', async () => {
    await assert.rejects(
      reader.parse(MINIMAL_MANIFEST.replaceAll('heimdall/v1', 'heimdall/v9')),
      rejectsWith(ManifestErrorCode.ManifestUnsupportedVersion, 'heimdall/v9', 'heimdall/v1'),
    );
  });

  it('rejects a file mixing apiVersions', async () => {
    await assert.rejects(
      reader.parse(
        MINIMAL_MANIFEST.replace(
          'apiVersion: heimdall/v1\nkind: Component',
          'apiVersion: heimdall/v2\nkind: Component',
        ),
      ),
      rejectsWith(ManifestErrorCode.ManifestUnsupportedVersion, 'heimdall/v1, heimdall/v2'),
    );
  });

  it('supports YAML anchors and merge keys within a document', async () => {
    const manifest = await reader.parse(
      MINIMAL_MANIFEST.replace(
        '  metrics:\n',
        [
          '  telemetry:',
          '    metrics: { matchers: &identity { job: api } }',
          '  topology:',
          '    mode: cluster',
          '    members:',
          "      - { name: node-1, role: node, telemetry: { metrics: { matchers: { <<: *identity, instance: 'api-0:9100' } } } }",
          '  metrics:',
          '',
        ].join('\n'),
      ),
    );

    assert.deepEqual(
      plain(manifest.components[0]?.spec.topology?.members[0]?.telemetry.metrics?.matchers),
      {
        job: 'api',
        instance: 'api-0:9100',
      },
    );
  });
});
