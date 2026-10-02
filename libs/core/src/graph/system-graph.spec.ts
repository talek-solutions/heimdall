import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  compileReferenceManifest,
  ReferenceManifest,
} from './__fixtures__/reference-manifests.fixture';
import { VertexType } from './enums';
import type { SystemGraph } from './system-graph';

describe('SystemGraph traversal on the shop reference manifest', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await compileReferenceManifest(ReferenceManifest.Shop);
  });

  it('walks a functionality down to its flows and their ordered steps', () => {
    const paths = graph.path('functionality:ordering');

    assert.deepEqual(
      paths.map(({ flow, steps }) => [flow.name, steps.map((step) => step.position)]),
      [
        ['submit-order', [1, 2, 3]],
        ['fulfil-order', [1, 2]],
      ],
    );
  });

  it('returns no path for a vertex that is neither a flow nor a functionality', () => {
    assert.deepEqual(graph.path('component:kafka'), []);
  });

  it('walks a lagging replica up to the business capability it can break (README walk)', () => {
    const impact = graph.impact('member:mysql-main/replica-1');

    assert.deepEqual(impact.functionalities, ['functionality:ordering']);
    assert.deepEqual([...impact.flows].sort(), ['flow:fulfil-order', 'flow:submit-order']);
    assert.ok(impact.vertices.includes('step:submit-order#2'));
    assert.ok(!impact.vertices.includes('flow:status-push'));
  });

  it('bounds a neighbourhood by hops and leaves indicators out', () => {
    const { vertices, edges } = graph.subgraph('component:kafka', 1);

    assert.deepEqual([...vertices].sort(), [
      'component:kafka',
      'dependency:services-2/order-events-out',
      'dependency:services-3/order-events-in',
    ]);
    assert.equal(edges.length, 2);
    assert.ok(vertices.every((id) => graph.vertex(id)?.type !== VertexType.Indicator));
  });
});
