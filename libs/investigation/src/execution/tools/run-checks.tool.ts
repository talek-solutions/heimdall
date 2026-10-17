import { ToolAccess, toolOk, type IAgentTool } from '@heimdall/agent';
import { CheckKind } from '../../enums';
import { InvestigationErrorCode } from '../../errors';
import type { ICheck, ITimeWindow } from '../../interfaces';
import type { ICheckProblem, ICheckResult } from '../checks/check-result.interface';
import type { CheckRunner } from '../checks/check.runner';
import { ResultKind } from '../checks/result-kind.enum';
import type { EvidenceRunner } from '../evidence/evidence.runner';
import type { ExecutionSession } from '../execution.session';
import { logsTarget, tracesTarget } from './evidence-targets';
import { InvestigationTool } from './investigation-tool.enum';
import { checkWindow, invalid, nonEmptyString, object, WINDOW_SCHEMA } from './tool-input';

const MAX_CHECKS_PER_CALL = 10;

export interface IRunChecksInput {
  readonly checks: readonly string[];
  readonly window: ITimeWindow | undefined;
}

interface IRun {
  readonly results: readonly ICheckResult[];
  readonly queries: number;
}

export function runChecksTool(
  session: ExecutionSession,
  runner: CheckRunner,
  evidence: EvidenceRunner,
): IAgentTool<IRunChecksInput> {
  return {
    name: InvestigationTool.RunChecks,
    description:
      "Run planned checks by id (c1, c2, …). An indicator check returns, per role, deviation statistics against the baseline and, for SLO, threshold and nonZero expectations, code's verdict. A logs check returns log templates that are new or surging against the baseline, with redacted examples; a traces check returns the subject's span operations that got slower, are new or fail, with an exemplar trace. Pass a narrower window to zoom in, e.g. from an onset.",
    inputSchema: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_CHECKS_PER_CALL,
          description: 'Planned check ids, at most 10 per call',
        },
        window: WINDOW_SCHEMA,
      },
      required: ['checks'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const fields = object(input);
      const checks = fields?.['checks'];

      if (!Array.isArray(checks) || checks.length === 0 || !checks.every(nonEmptyString)) {
        return invalid('checks must be a non-empty list of check ids');
      }
      if (checks.length > MAX_CHECKS_PER_CALL) {
        return invalid(`at most ${MAX_CHECKS_PER_CALL} checks per call`);
      }
      const window = checkWindow(fields?.['window'], session.plan.window);

      return typeof window === 'string'
        ? invalid(window)
        : { ok: true, input: { checks: [...new Set(checks)], window } };
    },
    execute: async ({ checks, window }, { signal }) => {
      const results: ICheckResult[] = [];
      const problems: Array<ICheckProblem & { readonly check: string }> = [];
      let queries = 0;

      for (const id of checks) {
        const check = session.checks.get(id);

        if (check === undefined) {
          problems.push({
            check: id,
            errorCode: InvestigationErrorCode.UnknownCheck,
            message: `no planned check is called ${id}`,
          });
          continue;
        }
        const run = await runCheck(
          session,
          runner,
          evidence,
          check,
          window ?? session.plan.window,
          signal,
        );

        if (run === undefined) {
          problems.push({
            check: id,
            errorCode: InvestigationErrorCode.UnknownVertex,
            message: `${check.subject} cannot be read as a ${check.kind} check`,
          });
          continue;
        }
        results.push(...run.results);
        queries += run.queries;
      }
      return toolOk({ results, problems }, summarise(results, problems.length), queries);
    },
  };
}

export function summarise(results: readonly ICheckResult[], problems: number): string {
  const parts = results.map((result) => {
    switch (result.kind) {
      case ResultKind.Indicator:
        return `${result.check ?? result.indicator} ${result.role} ${result.verdict ?? result.signal}`;
      case ResultKind.Logs:
        return `${result.check ?? result.subject} logs ${result.problem?.errorCode ?? `${result.templates.new.length} new, ${result.templates.surging.length} surging`}`;
      case ResultKind.Traces:
        return `${result.check ?? result.subject} traces ${result.problem?.errorCode ?? `${result.operations.filter((operation) => operation.changes.length > 0).length} changed operations`}`;
      case ResultKind.Trace:
        return `${result.subject} ${result.problem?.errorCode ?? `${result.trace?.spans.length ?? 0} spans`}`;
    }
  });
  return [...parts, ...(problems === 0 ? [] : [`${problems} not run`])].join('; ');
}

async function runCheck(
  session: ExecutionSession,
  runner: CheckRunner,
  evidence: EvidenceRunner,
  check: ICheck,
  window: ITimeWindow,
  signal: AbortSignal,
): Promise<IRun | undefined> {
  switch (check.kind) {
    case CheckKind.Indicator:
      return check.indicator === undefined
        ? undefined
        : runner.run(
            session,
            { check: check.id, indicator: check.indicator, roles: check.roles },
            window,
            signal,
          );
    case CheckKind.Logs: {
      const target = logsTarget(session, check);
      return target === undefined
        ? undefined
        : single(await evidence.logs(session, target, window, signal));
    }
    case CheckKind.Traces: {
      const target = tracesTarget(session, check);
      return target === undefined
        ? undefined
        : single(await evidence.traces(session, target, window, signal));
    }
  }
}

function single(run: { readonly result: ICheckResult; readonly queries: number }): IRun {
  return { results: [run.result], queries: run.queries };
}
