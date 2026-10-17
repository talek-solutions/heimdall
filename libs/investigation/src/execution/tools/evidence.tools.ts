import { ToolAccess, toolError, toolOk, type IAgentTool } from '@heimdall/agent';
import { InvestigationErrorCode } from '../../errors';
import type { ITimeWindow } from '../../interfaces';
import type { EvidenceRunner } from '../evidence/evidence.runner';
import type { ExecutionSession } from '../execution.session';
import { componentOf } from './evidence-targets';
import { InvestigationTool } from './investigation-tool.enum';
import { reach } from './reach';
import { summarise } from './run-checks.tool';
import {
  checkWindow,
  invalid,
  nonEmptyString,
  object,
  WINDOW_SCHEMA,
  type Fields,
} from './tool-input';

const MAX_LITERAL_LENGTH = 100;
const CONTROL = /[\u0000-\u001f\u007f]/;
const TRACE_ID = /^[0-9a-fA-F]{16,32}$/;

export interface ISearchLogsInput {
  readonly component: string;
  readonly contains: string | undefined;
  readonly window: ITimeWindow | undefined;
  readonly reason: string | undefined;
}

export interface ISearchTracesInput {
  readonly component: string;
  readonly operation: string | undefined;
  readonly errorsOnly: boolean;
  readonly window: ITimeWindow | undefined;
  readonly reason: string | undefined;
}

export interface IGetTraceInput {
  readonly traceId: string;
}

const COMPONENT_SCHEMA = {
  type: 'string',
  description: 'A component id, e.g. component:orders-pg',
} as const;
const REASON_SCHEMA = { type: 'string', description: 'Why look at a pruned component' } as const;

/** Logs and traces within reach (ADR 0018, Tools), redacted by the telemetry sources. */
export function evidenceTools(session: ExecutionSession, evidence: EvidenceRunner): IAgentTool[] {
  const searchLogs: IAgentTool<ISearchLogsInput> = {
    name: InvestigationTool.SearchLogs,
    description:
      "Read a component's logs, planned or not: templates that are new, surging or vanished against the baseline, with redacted examples. contains narrows to lines holding a literal text, e.g. a correlation value from another result. Only fields the manifest maps are returned.",
    inputSchema: {
      type: 'object',
      properties: {
        component: COMPONENT_SCHEMA,
        contains: {
          type: 'string',
          description:
            'Optional literal text a line must contain (no regex), at most 100 characters',
        },
        window: WINDOW_SCHEMA,
        reason: REASON_SCHEMA,
      },
      required: ['component'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const fields = object(input);
      const component = fields?.['component'];
      const contains = fields?.['contains'];

      if (!nonEmptyString(component)) {
        return invalid('component must be a component id');
      }
      if (
        contains !== undefined &&
        (!nonEmptyString(contains) ||
          contains.length > MAX_LITERAL_LENGTH ||
          CONTROL.test(contains))
      ) {
        return invalid(
          `contains must be literal text of at most ${MAX_LITERAL_LENGTH} characters on one line`,
        );
      }
      const window = checkWindow(fields?.['window'], session.plan.window);

      return typeof window === 'string'
        ? invalid(window)
        : { ok: true, input: { component, contains, window, reason: reasonOf(fields) } };
    },
    execute: async ({ component: id, contains, window, reason }, { signal }) => {
      const component = componentOf(session, id);

      if (component === undefined) {
        return toolError(InvestigationErrorCode.UnknownVertex, `no component is called ${id}`);
      }
      const decision = reach(session, id, reason);

      if (!decision.ok) {
        return toolError(InvestigationErrorCode.OutOfReach, decision.message);
      }
      const run = await evidence.logs(
        session,
        { check: null, component, contains },
        window ?? session.plan.window,
        signal,
      );

      return toolOk(
        { results: [run.result], problems: [] },
        summarise([run.result], 0),
        run.queries,
      );
    },
  };

  const searchTraces: IAgentTool<ISearchTracesInput> = {
    name: InvestigationTool.SearchTraces,
    description:
      "Read a component's spans, planned or not: its operations (span names) that got slower, are new or fail against the baseline, with an exemplar trace. operation narrows to one span name; errorsOnly reads failed spans only.",
    inputSchema: {
      type: 'object',
      properties: {
        component: COMPONENT_SCHEMA,
        operation: { type: 'string', description: 'Optional exact span name' },
        errorsOnly: { type: 'boolean', description: 'Only spans with an error status' },
        window: WINDOW_SCHEMA,
        reason: REASON_SCHEMA,
      },
      required: ['component'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const fields = object(input);
      const component = fields?.['component'];
      const operation = fields?.['operation'];
      const errorsOnly = fields?.['errorsOnly'];

      if (!nonEmptyString(component)) {
        return invalid('component must be a component id');
      }
      if (
        operation !== undefined &&
        (!nonEmptyString(operation) ||
          operation.length > MAX_LITERAL_LENGTH ||
          CONTROL.test(operation))
      ) {
        return invalid(`operation must be a span name of at most ${MAX_LITERAL_LENGTH} characters`);
      }
      if (errorsOnly !== undefined && typeof errorsOnly !== 'boolean') {
        return invalid('errorsOnly must be true or false');
      }
      const window = checkWindow(fields?.['window'], session.plan.window);

      return typeof window === 'string'
        ? invalid(window)
        : {
            ok: true,
            input: {
              component,
              operation,
              errorsOnly: errorsOnly === true,
              window,
              reason: reasonOf(fields),
            },
          };
    },
    execute: async ({ component: id, operation, errorsOnly, window, reason }, { signal }) => {
      const component = componentOf(session, id);

      if (component === undefined) {
        return toolError(InvestigationErrorCode.UnknownVertex, `no component is called ${id}`);
      }
      const decision = reach(session, id, reason);

      if (!decision.ok) {
        return toolError(InvestigationErrorCode.OutOfReach, decision.message);
      }
      const run = await evidence.traces(
        session,
        { check: null, component, operation, errorsOnly },
        window ?? session.plan.window,
        signal,
      );

      return toolOk(
        { results: [run.result], problems: [] },
        summarise([run.result], 0),
        run.queries,
      );
    },
  };

  const getTrace: IAgentTool<IGetTraceInput> = {
    name: InvestigationTool.GetTrace,
    description:
      'Read one trace by id, e.g. a traceId field of a log example, as a redacted span tree: services, operations, durations, statuses and allowlisted attributes.',
    inputSchema: {
      type: 'object',
      properties: { traceId: { type: 'string', description: 'A hex trace id' } },
      required: ['traceId'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const traceId = object(input)?.['traceId'];

      return typeof traceId === 'string' && TRACE_ID.test(traceId)
        ? { ok: true, input: { traceId: traceId.toLowerCase() } }
        : invalid('traceId must be a hex trace id of 16 to 32 characters');
    },
    execute: async ({ traceId }, { signal }) => {
      const run = await evidence.trace(session, traceId, signal);

      return toolOk(
        { results: [run.result], problems: [] },
        summarise([run.result], 0),
        run.queries,
      );
    },
  };

  return [searchLogs, searchTraces, getTrace];
}

function reasonOf(fields: Fields | undefined): string | undefined {
  const reason = fields?.['reason'];
  return typeof reason === 'string' ? reason : undefined;
}
