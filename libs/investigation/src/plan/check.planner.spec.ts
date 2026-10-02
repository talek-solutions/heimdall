import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { SystemGraph } from '@heimdall/core/graph';
import { IndicatorRole } from '@heimdall/core/manifest';
import { loadGraph, ReferenceManifest, testConfig } from '../__fixtures__/investigation.fixture';
import { BlindSpotReason, CheckKind, CheckTier } from '../enums';
import type { ICheck } from '../interfaces';
import { ScopeResolver } from '../scope/scope.resolver';
import { CheckPlanner, type IPlannedChecks } from './check.planner';

const NOT_WORKING = [IndicatorRole.Errors, IndicatorRole.Throughput, IndicatorRole.Kpi];
const TIERS = [
  CheckTier.Confirm,
  CheckTier.Localise,
  CheckTier.Explain,
  CheckTier.Corroborate,
  CheckTier.Impact,
];

function plan(
  graph: SystemGraph,
  entry: string,
  roles: IndicatorRole[],
  maxChecks = 200,
): IPlannedChecks {
  const config = testConfig({ maxChecks });
  const scope = new ScopeResolver(config).resolve(graph, entry, roles);
  return new CheckPlanner(config).plan(graph, entry, scope, roles);
}

function inTier(checks: readonly ICheck[], tier: CheckTier): ICheck[] {
  return checks.filter((check) => check.tier === tier);
}

describe('CheckPlanner on shop, for "checkouts are not working"', () => {
  let graph: SystemGraph;
  let planned: IPlannedChecks;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Shop);
    planned = plan(graph, 'functionality:ordering', NOT_WORKING);
  });

  it('numbers checks in tier order', () => {
    const order = planned.checks.map((check) => TIERS.indexOf(check.tier));

    assert.deepEqual(
      order,
      [...order].sort((left, right) => left - right),
    );
    assert.deepEqual(planned.checks.map((check) => check.id).slice(0, 3), ['c1', 'c2', 'c3']);
  });

  it('confirms with every KPI and the flow SLO, unfiltered by the symptom', () => {
    assert.deepEqual(
      inTier(planned.checks, CheckTier.Confirm).map((check) => check.subject),
      ['functionality:ordering', 'functionality:ordering', 'flow:submit-order'],
    );
  });

  it('localises step by step, keeping only the roles of the symptom', () => {
    const localise = inTier(planned.checks, CheckTier.Localise);

    assert.deepEqual(
      localise.map((check) => [check.subject, check.roles]),
      [
        ['step:submit-order#1', [IndicatorRole.Throughput, IndicatorRole.Errors]],
        ['step:submit-order#2', [IndicatorRole.Throughput, IndicatorRole.Errors]],
        ['step:submit-order#3', [IndicatorRole.Errors]],
      ],
    );
    assert.ok(localise.every((check) => check.when === undefined));
  });

  it('explains a failing write behind its target and the caller competing for it', () => {
    const explain = inTier(planned.checks, CheckTier.Explain).filter((check) =>
      check.when?.failingSteps.includes('step:submit-order#2'),
    );
    const metrics = explain.map((check) => check.indicator?.metric);

    assert.ok(metrics.includes('mysql-main/mysql_global_status_threads_connected'));
    assert.ok(metrics.includes('services-2/nodejs_eventloop_lag_seconds'));
    assert.ok(metrics.includes('services-3/db_client_seconds'));
  });

  it('checks soft dependencies after hard ones', () => {
    const behindStepOne = inTier(planned.checks, CheckTier.Explain)
      .filter((check) => check.when?.failingSteps.includes('step:submit-order#1'))
      .map((check) => check.indicator?.metric ?? '');
    const mysql = behindStepOne.indexOf('mysql-main/mysql_global_status_threads_connected');
    const redis = behindStepOne.indexOf('redis-cache/redis_evicted_keys_total');

    assert.ok(mysql >= 0 && redis > mysql, behindStepOne.join(', '));
  });

  it('corroborates with logs and traces narrowed to the failing step', () => {
    const corroborate = inTier(planned.checks, CheckTier.Corroborate);
    const logs = corroborate.find(
      (check) =>
        check.kind === CheckKind.Logs &&
        check.subject === 'component:services-2' &&
        check.when?.failingSteps.includes('step:submit-order#2'),
    );

    assert.deepEqual(logs?.match, { operation: 'INSERT', table: 'orders' });
    assert.ok(corroborate.some((check) => check.kind === CheckKind.Traces));
  });

  it('reports the async flow as impact', () => {
    assert.deepEqual(
      inTier(planned.checks, CheckTier.Impact).map((check) => check.indicator?.metric),
      ['services-3/order_fulfilment_seconds'],
    );
  });

  it('names the in-scope parts it cannot see', () => {
    assert.ok(
      planned.blindSpots.some(
        (spot) =>
          spot.vertex === 'member:mysql-main/primary' &&
          spot.reason === BlindSpotReason.NoIndicators,
      ),
    );
  });

  it('caps the plan from the end and counts what it dropped', () => {
    const capped = plan(graph, 'functionality:ordering', NOT_WORKING, 5);

    assert.equal(capped.checks.length, 5);
    assert.equal(capped.omittedChecks, planned.checks.length - 5);
    assert.deepEqual(capped.checks, planned.checks.slice(0, 5));
  });
});

describe('CheckPlanner on checkout', () => {
  it('reads the logs of a batch job sharing the database, which has no indicators', async () => {
    const graph = await loadGraph(ReferenceManifest.Checkout);
    const { checks, blindSpots } = plan(graph, 'functionality:checkout', [IndicatorRole.Latency]);
    const reconcile = checks.find((check) => check.subject === 'component:orders-reconcile');

    assert.equal(reconcile?.kind, CheckKind.Logs);
    assert.deepEqual(reconcile?.when?.failingSteps, ['step:place-order#3']);
    assert.deepEqual(
      blindSpots.map((spot) => [spot.vertex, spot.reason]),
      [
        ['component:web', BlindSpotReason.NoTelemetry],
        ['component:payment-provider', BlindSpotReason.NoTelemetry],
        ['component:stock-cache', BlindSpotReason.NoTelemetry],
        ['component:orders-reconcile', BlindSpotReason.NoIndicators],
      ],
    );
  });
});

describe('CheckPlanner for a component entry', () => {
  it('confirms on the component, then looks at members and competing callers', async () => {
    const graph = await loadGraph(ReferenceManifest.Shop);
    const { checks } = plan(graph, 'component:mysql-main', [IndicatorRole.Latency]);

    assert.equal(checks[0]?.tier, CheckTier.Confirm);
    assert.equal(checks[0]?.subject, 'component:mysql-main');
    assert.ok(checks.some((check) => check.subject === 'member:mysql-main/replica-1'));
    assert.ok(checks.some((check) => check.subject === 'step:fulfil-order#2'));
    assert.ok(checks.every((check) => check.when === undefined));
  });
});
