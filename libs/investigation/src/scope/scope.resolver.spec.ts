import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { SystemGraph } from '@heimdall/core/graph';
import { IndicatorRole } from '@heimdall/core/manifest';
import { loadGraph, ReferenceManifest, testConfig } from '../__fixtures__/investigation.fixture';
import { PruneReason, ScopeReason } from '../enums';
import type { IInvestigationScope } from '../interfaces';
import { ScopeResolver } from './scope.resolver';

const NOT_WORKING = [IndicatorRole.Errors, IndicatorRole.Throughput, IndicatorRole.Kpi];

function reasonOf(scope: IInvestigationScope, vertex: string): ScopeReason | undefined {
  return scope.vertices.find((scoped) => scoped.vertex === vertex)?.reason;
}

function prunedAs(scope: IInvestigationScope, vertex: string): PruneReason | undefined {
  return scope.pruned.find((pruned) => pruned.vertex === vertex)?.reason;
}

describe('ScopeResolver on shop, entering at the ordering functionality', () => {
  let graph: SystemGraph;
  let scope: IInvestigationScope;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Shop);
    scope = new ScopeResolver(testConfig()).resolve(graph, 'functionality:ordering', NOT_WORKING);
  });

  it('suspects the sync flow and keeps the async one as impact only', () => {
    assert.deepEqual(scope.suspectFlows, ['flow:submit-order']);
    assert.deepEqual(scope.impactFlows, ['flow:fulfil-order']);
  });

  it('walks every step of the suspect flow to its dependency and components', () => {
    for (const vertex of ['step:submit-order#1', 'step:submit-order#2', 'step:submit-order#3']) {
      assert.equal(reasonOf(scope, vertex), ScopeReason.Step, vertex);
    }
    assert.equal(reasonOf(scope, 'dependency:services-2/orders-db'), ScopeReason.PathDependency);
    assert.equal(reasonOf(scope, 'component:mysql-main'), ScopeReason.PathComponent);
  });

  it('routes a write to the primary and drops the replicas', () => {
    assert.equal(reasonOf(scope, 'member:mysql-main/primary'), ScopeReason.RoutedMember);
    assert.equal(prunedAs(scope, 'member:mysql-main/replica-1'), PruneReason.NotRouted);
    assert.equal(prunedAs(scope, 'member:mysql-main/replica-2'), PruneReason.NotRouted);
  });

  it('never drops a soft dependency of a component on the path', () => {
    assert.equal(reasonOf(scope, 'dependency:services-2/status-cache'), ScopeReason.Neighbour);
    assert.equal(reasonOf(scope, 'component:redis-cache'), ScopeReason.Neighbour);
  });

  it('keeps other callers of a shared target as contention', () => {
    assert.equal(reasonOf(scope, 'dependency:services-3/orders-db'), ScopeReason.Contention);
    assert.equal(reasonOf(scope, 'component:services-3'), ScopeReason.Contention);
  });

  it('gives every dropped vertex a reason', () => {
    assert.equal(prunedAs(scope, 'functionality:order-tracking'), PruneReason.Unreachable);
    assert.equal(prunedAs(scope, 'flow:status-push'), PruneReason.Unreachable);
    assert.equal(
      prunedAs(scope, 'dependency:services-3/status-cache'),
      PruneReason.BeyondHopBudget,
    );
    assert.equal(prunedAs(scope, 'flow:fulfil-order'), undefined);
  });
});

describe('ScopeResolver rules', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Shop);
  });

  it('suspects async flows too when the symptom is lag', () => {
    const scope = new ScopeResolver(testConfig()).resolve(graph, 'functionality:ordering', [
      IndicatorRole.Lag,
    ]);

    assert.deepEqual(scope.suspectFlows, ['flow:submit-order', 'flow:fulfil-order']);
    assert.deepEqual(scope.impactFlows, []);
  });

  it('keeps neighbours and contention out with a hop budget of zero', () => {
    const scope = new ScopeResolver(testConfig({ hopBudget: 0 })).resolve(
      graph,
      'functionality:ordering',
      NOT_WORKING,
    );

    assert.equal(reasonOf(scope, 'component:redis-cache'), undefined);
    assert.equal(
      prunedAs(scope, 'dependency:services-2/status-cache'),
      PruneReason.BeyondHopBudget,
    );
    assert.equal(reasonOf(scope, 'component:services-3'), undefined);
  });

  it('scopes a component entry to its members and the callers competing for it', () => {
    const scope = new ScopeResolver(testConfig()).resolve(graph, 'component:mysql-main', [
      IndicatorRole.Latency,
    ]);

    assert.deepEqual(scope.suspectFlows, []);
    assert.deepEqual([...scope.impactFlows].sort(), ['flow:fulfil-order', 'flow:submit-order']);
    assert.equal(reasonOf(scope, 'member:mysql-main/replica-1'), ScopeReason.RoutedMember);
    assert.equal(reasonOf(scope, 'dependency:services-2/orders-db'), ScopeReason.Contention);
    assert.equal(reasonOf(scope, 'dependency:services-3/orders-db'), ScopeReason.Contention);
  });
});

describe('ScopeResolver on checkout', () => {
  it('reaches the batch job that shares the orders database', async () => {
    const graph = await loadGraph(ReferenceManifest.Checkout);
    const scope = new ScopeResolver(testConfig()).resolve(
      graph,
      'functionality:checkout',
      NOT_WORKING,
    );

    assert.equal(reasonOf(scope, 'component:orders-reconcile'), ScopeReason.Contention);
    assert.equal(reasonOf(scope, 'component:stock-cache'), ScopeReason.Neighbour);
    assert.deepEqual(scope.pruned, []);
  });
});
