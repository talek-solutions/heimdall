import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import {
  compileReferenceManifest,
  ReferenceManifest,
  referenceManifestPath,
} from '../__fixtures__/reference-manifests.fixture';
import type { SystemGraph } from '../system-graph';
import { renderLevelZero } from './level-zero.view';

describe('renderLevelZero on the shop reference manifest', () => {
  let graph: SystemGraph;
  let view: string;

  before(async () => {
    graph = await compileReferenceManifest(ReferenceManifest.Shop);
    view = renderLevelZero(graph, 'prod');
  });

  it('leads with the system and the environment', () => {
    assert.ok(view.startsWith('system shop · env prod — Online ordering'));
  });

  it('lists each flow under its functionality, steps in order', () => {
    assert.ok(
      view.includes(
        '  flow:submit-order  sync: frontend/orders-api POST /orders ▸ services-2/orders-db INSERT orders ▸ services-2/order-events-out order-events\n',
      ),
    );
    assert.ok(view.includes('  flow:fulfil-order  async, no trace context, join on orderId: '));
  });

  it('shows dependencies with mode, criticality and read/write routing', () => {
    assert.ok(
      view.includes(
        'component:services-2  service → kafka kafka async hard · redis-cache redis sync soft · mysql-main sql sync hard w:primary r:replicas\n',
      ),
    );
    assert.ok(view.includes('  member:mysql-main/replica-1  replica\n'));
  });

  it('reports dependencies no flow travels over', () => {
    assert.ok(view.endsWith('not on any flow: dependency:services-3/status-cache\n'));
  });

  it('keeps matchers and instance addresses out, and stays well under the manifest size', () => {
    const manifest = readFileSync(referenceManifestPath(ReferenceManifest.Shop), 'utf8');

    assert.ok(!view.includes('mysql-1:9104'));
    assert.ok(!view.includes('job'));
    assert.ok(view.length < manifest.length / 3, `${view.length} vs ${manifest.length}`);
  });
});
