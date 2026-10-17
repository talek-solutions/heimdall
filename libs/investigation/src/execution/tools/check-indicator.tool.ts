import { ToolAccess, toolError, toolOk, type IAgentTool } from '@heimdall/agent';
import { VertexType } from '@heimdall/core/graph';
import { InvestigationErrorCode } from '../../errors';
import type { ITimeWindow } from '../../interfaces';
import type { CheckRunner } from '../checks/check.runner';
import type { ExecutionSession } from '../execution.session';
import { InvestigationTool } from './investigation-tool.enum';
import { reach } from './reach';
import { summarise } from './run-checks.tool';
import { checkWindow, invalid, nonEmptyString, object, WINDOW_SCHEMA } from './tool-input';

export interface ICheckIndicatorInput {
  readonly indicator: string;
  readonly window: ITimeWindow | undefined;
  readonly reason: string | undefined;
}

export function checkIndicatorTool(
  session: ExecutionSession,
  runner: CheckRunner,
): IAgentTool<ICheckIndicatorInput> {
  return {
    name: InvestigationTool.CheckIndicator,
    description:
      'Run any indicator by id (indicator:<subject>@<n>, see describe_vertex), planned or not, over every role it serves. Its subject must be in scope; for a pruned subject, say why in reason.',
    inputSchema: {
      type: 'object',
      properties: {
        indicator: { type: 'string', description: 'An indicator id' },
        window: WINDOW_SCHEMA,
        reason: { type: 'string', description: 'Why look at a pruned subject' },
      },
      required: ['indicator'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const fields = object(input);
      const indicator = fields?.['indicator'];
      const reason = fields?.['reason'];

      if (!nonEmptyString(indicator)) {
        return invalid('indicator must be an indicator id');
      }
      const window = checkWindow(fields?.['window'], session.plan.window);

      return typeof window === 'string'
        ? invalid(window)
        : {
            ok: true,
            input: { indicator, window, reason: typeof reason === 'string' ? reason : undefined },
          };
    },
    execute: async ({ indicator: id, window, reason }, { signal }) => {
      const indicator = session.graph.vertexOfType(id, VertexType.Indicator);

      if (indicator === undefined) {
        return toolError(InvestigationErrorCode.UnknownVertex, `no indicator is called ${id}`);
      }
      const decision = reach(session, indicator.subject, reason);

      if (!decision.ok) {
        return toolError(InvestigationErrorCode.OutOfReach, decision.message);
      }
      const planned = session.plan.checks.find((check) => check.indicator?.id === id)?.id ?? null;
      const run = await runner.run(
        session,
        { check: planned, indicator, roles: indicator.roles },
        window ?? session.plan.window,
        signal,
      );

      return toolOk({ results: run.results, problems: [] }, summarise(run.results, 0), run.queries);
    },
  };
}
