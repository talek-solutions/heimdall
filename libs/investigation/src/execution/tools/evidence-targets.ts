import { VertexType, type IComponentVertex } from '@heimdall/core/graph';
import type { ICheck } from '../../interfaces';
import type { ILogsTarget, ITracesTarget } from '../evidence/evidence.runner';
import type { ExecutionSession } from '../execution.session';

/** A planned logs check, as the evidence runner reads it; `undefined` if its subject is not a component. */
export function logsTarget(session: ExecutionSession, check: ICheck): ILogsTarget | undefined {
  const component = componentOf(session, check.subject);

  return component === undefined
    ? undefined
    : { check: check.id, component, match: check.match, correlationKey: check.correlationKey };
}

/** A planned traces check: around a hop, the subject's end of it, client or server spans. */
export function tracesTarget(session: ExecutionSession, check: ICheck): ITracesTarget | undefined {
  const component = componentOf(session, check.subject);
  const dependency =
    check.hop === undefined
      ? undefined
      : session.graph.vertexOfType(check.hop.dependency, VertexType.Dependency);

  return component === undefined
    ? undefined
    : {
        check: check.id,
        component,
        hop:
          check.hop === undefined || dependency === undefined
            ? undefined
            : { side: check.hop.side, mode: dependency.mode },
        match: check.match,
        errorsOnly: false,
      };
}

export function componentOf(session: ExecutionSession, id: string): IComponentVertex | undefined {
  return session.graph.vertexOfType(id, VertexType.Component);
}
