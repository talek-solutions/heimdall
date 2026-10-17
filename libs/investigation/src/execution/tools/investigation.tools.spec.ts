import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { ToolResultStatus } from '@heimdall/agent';
import { checkoutPlan, PLACEHOLDER_SOURCES } from '../../__fixtures__/execution.fixture';
import { CheckKind } from '../../enums';
import { InvestigationErrorCode } from '../../errors';
import type { CheckRunner } from '../checks/check.runner';
import { ResultKind } from '../checks/result-kind.enum';
import type { EvidenceRunner, ILogsTarget } from '../evidence/evidence.runner';
import { ConclusionValidator } from '../conclusion/conclusion.validator';
import { ExecutionSession } from '../execution.session';
import { checkIndicatorTool } from './check-indicator.tool';
import { concludeTool } from './conclude.tool';
import { evidenceTools } from './evidence.tools';
import { graphTools } from './graph.tools';
import { InvestigationTool } from './investigation-tool.enum';
import { reach } from './reach';
import { runChecksTool } from './run-checks.tool';

const context = { callId: 'call', signal: new AbortController().signal };

/** Runs nothing: these specs are about guards and reach, not telemetry. */
const idleRunner = {
  run: async () => ({ results: [], queries: 0 }),
} as unknown as CheckRunner;

/** Answers every logs read with an empty result, so a spec sees what the tool did with it. */
const idleEvidence = {
  logs: async (_session: ExecutionSession, target: ILogsTarget) => ({
    result: {
      result: 'r1',
      kind: ResultKind.Logs,
      check: target.check,
      subject: target.component.id,
      templates: { new: [], surging: [], steady: [], vanished: [] },
      problem: null,
    },
    queries: 8,
  }),
} as unknown as EvidenceRunner;

describe('investigation tools', () => {
  let session: ExecutionSession;

  before(async () => {
    const { plan, graph } = await checkoutPlan();
    session = new ExecutionSession(graph, plan, PLACEHOLDER_SOURCES, {});
  });

  it('run_checks accepts up to ten ids and a window inside the plan, and refuses the rest', () => {
    const tool = runChecksTool(session, idleRunner, idleEvidence);
    const { window } = session.plan;

    assert.equal(tool.parse({ checks: ['c1', 'c1', 'c2'] }).ok, true);
    assert.equal(tool.parse({ checks: [] }).ok, false);
    assert.equal(tool.parse({ checks: Array.from({ length: 11 }, (_, i) => `c${i}`) }).ok, false);
    assert.equal(
      tool.parse({
        checks: ['c1'],
        window: { start: window.start.toISOString(), end: window.end.toISOString() },
      }).ok,
      true,
    );
    assert.equal(
      tool.parse({
        checks: ['c1'],
        window: {
          start: window.start.toISOString(),
          end: new Date(window.end.getTime() + 60_000).toISOString(),
        },
      }).ok,
      false,
      'no window ends after the investigation',
    );
    assert.equal(
      tool.parse({
        checks: ['c1'],
        window: { start: window.end.toISOString(), end: window.end.toISOString() },
      }).ok,
      false,
      'a window is at least a minute long',
    );
  });

  it('run_checks reports unknown ids as problems, and runs logs checks as evidence', async () => {
    const tool = runChecksTool(session, idleRunner, idleEvidence);
    const logs = session.plan.checks.find((check) => check.kind === CheckKind.Logs)?.id ?? '';
    const parsed = tool.parse({ checks: ['c999', logs] });
    assert.ok(parsed.ok);
    const result = await tool.execute(parsed.input, context);
    const { problems, results } = result.content as {
      problems: Array<{ errorCode: string }>;
      results: Array<{ kind: string; check: string }>;
    };

    assert.equal(result.status, ToolResultStatus.Ok);
    assert.deepEqual(
      problems.map((problem) => problem.errorCode),
      [InvestigationErrorCode.UnknownCheck],
    );
    assert.deepEqual(
      results.map(({ kind, check }) => ({ kind, check })),
      [{ kind: ResultKind.Logs, check: logs }],
    );
    assert.equal(result.cost, 8);
  });

  it('search tools take literal text and hex trace ids only, and keep to the reach', async () => {
    const tools = new Map(evidenceTools(session, idleEvidence).map((tool) => [tool.name, tool]));
    const logs = tools.get(InvestigationTool.SearchLogs);
    const traces = tools.get(InvestigationTool.SearchTraces);
    const trace = tools.get(InvestigationTool.GetTrace);
    assert.ok(logs && traces && trace);

    assert.equal(logs.parse({ component: 'component:orders-pg', contains: 'ShareLock' }).ok, true);
    assert.equal(logs.parse({ component: 'component:orders-pg', contains: 'a\nb' }).ok, false);
    assert.equal(
      logs.parse({ component: 'component:orders-pg', contains: 'x'.repeat(101) }).ok,
      false,
    );
    assert.equal(traces.parse({ component: 'component:checkout', errorsOnly: 'yes' }).ok, false);
    assert.equal(trace.parse({ traceId: '4bf92f3577b34da6a3ce929d0e0e4736' }).ok, true);
    assert.equal(trace.parse({ traceId: '../../api/admin' }).ok, false);

    const outside = await logs.execute(
      {
        component: 'component:elsewhere',
        contains: undefined,
        window: undefined,
        reason: undefined,
      },
      context,
    );
    assert.equal(
      (outside.content as { errorCode: string }).errorCode,
      InvestigationErrorCode.UnknownVertex,
    );
  });

  it('reaches the scope freely, a pruned vertex only with a reason, and nothing else', () => {
    const inScope = session.plan.scope.vertices[0]?.vertex ?? '';

    assert.deepEqual(reach(session, inScope, undefined), { ok: true });
    assert.equal(reach(session, 'component:elsewhere', 'curious').ok, false);
  });

  it('check_indicator refuses an indicator that does not exist', async () => {
    const tool = checkIndicatorTool(session, idleRunner);
    const unknown = await tool.execute(
      { indicator: 'indicator:nope@1', window: undefined, reason: undefined },
      context,
    );

    assert.equal(
      (unknown.content as { errorCode: string }).errorCode,
      InvestigationErrorCode.UnknownVertex,
    );
  });

  it('describe_vertex hides telemetry matchers and lists indicators with their planned checks', async () => {
    const [describe] = graphTools(session);
    assert.ok(describe);
    const result = await describe.execute({ vertex: 'component:checkout' }, context);
    const content = result.content as {
      vertex: Record<string, unknown>;
      indicators: Array<{ id: string; planned: string[] }>;
      scope: string;
    };

    assert.equal('telemetry' in content.vertex, false);
    assert.deepEqual(content.vertex['signals'], ['logs', 'metrics', 'traces']);
    assert.ok(content.indicators.some((indicator) => indicator.planned.length > 0));
    assert.equal(content.scope, 'path-component');
    assert.equal(JSON.stringify(content).includes('matchers'), false);
  });

  it('conclude checks its input shape before the validator sees it', () => {
    const tool = concludeTool(session, new ConclusionValidator());

    assert.equal(tool.parse({ outcome: 'maybe' }).ok, false);
    assert.equal(
      tool.parse({
        outcome: 'no-signal',
        summary: 'All quiet.',
        verdicts: [],
        evidence: [],
        confidence: 1.5,
        mitigations: [],
      }).ok,
      false,
    );
    assert.equal(
      tool.parse({
        outcome: 'no-signal',
        summary: 'All quiet.',
        verdicts: [{ result: 'r1', verdict: 'healthy', reason: 'flat' }],
        evidence: [],
        confidence: 0.6,
        mitigations: [],
      }).ok,
      true,
    );
  });
});
