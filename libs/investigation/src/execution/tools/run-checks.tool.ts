import { ToolAccess, toolOk, type IAgentTool } from '@heimdall/agent';
import { CheckKind } from '../../enums';
import { InvestigationErrorCode } from '../../errors';
import type { ITimeWindow } from '../../interfaces';
import type { ICheckProblem, IRoleResult } from '../checks/check-result.interface';
import type { CheckRunner } from '../checks/check.runner';
import type { ExecutionSession } from '../execution.session';
import { InvestigationTool } from './investigation-tool.enum';
import { checkWindow, invalid, nonEmptyString, object, WINDOW_SCHEMA } from './tool-input';

const MAX_CHECKS_PER_CALL = 10;

export interface IRunChecksInput {
  readonly checks: readonly string[];
  readonly window: ITimeWindow | undefined;
}

export function runChecksTool(
  session: ExecutionSession,
  runner: CheckRunner,
): IAgentTool<IRunChecksInput> {
  return {
    name: InvestigationTool.RunChecks,
    description:
      "Run planned checks by id (c1, c2, …) and get, per role, deviation statistics against the baseline and, for SLO, threshold and nonZero expectations, code's verdict. Pass a narrower window to zoom in on a short or borderline deviation.",
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
      const results: IRoleResult[] = [];
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
        if (check.kind !== CheckKind.Indicator || check.indicator === undefined) {
          problems.push({
            check: id,
            errorCode: InvestigationErrorCode.CheckUnavailable,
            message: `${check.kind} checks are not available yet; they arrive with logs and traces evidence`,
          });
          continue;
        }
        const run = await runner.run(
          session,
          { check: id, indicator: check.indicator, roles: check.roles },
          window ?? session.plan.window,
          signal,
        );

        results.push(...run.results);
        queries += run.queries;
      }
      return toolOk({ results, problems }, summarise(results, problems.length), queries);
    },
  };
}

export function summarise(results: readonly IRoleResult[], problems: number): string {
  const parts = results.map(
    (result) =>
      `${result.check ?? result.indicator} ${result.role} ${result.verdict ?? result.signal}`,
  );
  return [...parts, ...(problems === 0 ? [] : [`${problems} not run`])].join('; ');
}
