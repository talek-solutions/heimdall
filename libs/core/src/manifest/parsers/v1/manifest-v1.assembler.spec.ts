import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  componentV1,
  dependencyV1,
  flowV1,
  functionalityV1,
  metricV1,
  stepV1,
  systemV1,
} from '../../__fixtures__/manifest-v1.fixture';
import type { IManifestResourceV1 } from '../../interfaces/v1';
import type { IParsedResource } from '../manifest.parser';
import { ManifestV1Assembler } from './manifest-v1.assembler';

const assembler = new ManifestV1Assembler();

function parsed(...resources: IManifestResourceV1[]): IParsedResource<IManifestResourceV1>[] {
  return resources.map((resource, index) => ({ position: index + 1, resource }));
}

function issuesOf(resources: IParsedResource<IManifestResourceV1>[]): string[] {
  const assembly = assembler.assemble(resources);
  return assembly.valid
    ? []
    : assembly.issues.map(({ location, message }) => `${location}: ${message}`);
}

describe('ManifestV1Assembler', () => {
  it('groups resources by kind under the one System', () => {
    const assembly = assembler.assemble(
      parsed(
        systemV1(),
        componentV1('api', {
          dependsOn: [dependencyV1('db', 'mysql')],
          metrics: [metricV1('errors_total')],
        }),
        componentV1('mysql'),
        functionalityV1('ordering', { flows: ['submit'] }),
        flowV1('submit', { steps: [stepV1('api/db')] }),
      ),
    );

    assert.ok(assembly.valid);
    assert.equal(assembly.manifest.system.metadata.name, 'shop');
    assert.deepEqual(
      assembly.manifest.components.map((entry) => entry.metadata.name),
      ['api', 'mysql'],
    );
    assert.equal(assembly.manifest.functionalities.length, 1);
    assert.equal(assembly.manifest.flows.length, 1);
  });

  it('indexes resources the way the manifest refers to them', () => {
    const assembly = assembler.assemble(
      parsed(
        systemV1(),
        componentV1('api', {
          dependsOn: [dependencyV1('db', 'mysql')],
          metrics: [metricV1('errors_total')],
        }),
        flowV1('submit'),
      ),
    );

    assert.ok(assembly.valid);
    const { index } = assembly;
    assert.equal(index.component('api')?.metadata.name, 'api');
    assert.equal(index.dependency('api/db')?.target, 'mysql');
    assert.equal(index.metric('api/errors_total')?.name, 'errors_total');
    assert.equal(index.flow('submit')?.metadata.name, 'submit');
    assert.equal(index.dependency('api/cache'), undefined);
    assert.deepEqual(index.componentNames(), ['api']);
  });

  it('requires a System document', () => {
    assert.deepEqual(issuesOf(parsed(componentV1('api'))), [
      'manifest: no System document; a manifest describes exactly one system',
    ]);
  });

  it('rejects a second System', () => {
    const other = { ...systemV1(), metadata: { name: 'other', labels: {}, annotations: {} } };

    assert.deepEqual(issuesOf(parsed(systemV1(), componentV1('api'), other)), [
      'document 3 (System/other): a manifest describes exactly one system; document 1 already declares System/shop',
    ]);
  });

  it('rejects a resource that names another system', () => {
    const stray = componentV1('api');
    const moved = { ...stray, metadata: { ...stray.metadata, system: 'billing' } };

    assert.deepEqual(issuesOf(parsed(systemV1(), moved)), [
      "document 2 (Component/api) metadata.system: 'billing' is not this manifest's system 'shop'",
    ]);
  });

  it('rejects a duplicate kind and name, naming the first document', () => {
    assert.deepEqual(
      issuesOf(parsed(systemV1(), componentV1('api'), flowV1('submit'), componentV1('api'))),
      ['document 4 (Component/api): duplicates document 2'],
    );
  });

  it('allows the same name across kinds', () => {
    assert.deepEqual(issuesOf(parsed(systemV1(), componentV1('orders'), flowV1('orders'))), []);
  });
});
