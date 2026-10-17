import type { ExecutionSession } from '../execution.session';

export type IReachDecision =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * How far the agent may look (ADR 0018, Seed and reach): the scope, the impact flows, and a pruned
 * vertex when the call says why. The reason is kept for the report.
 */
export function reach(session: ExecutionSession, vertex: string, reason: unknown): IReachDecision {
  const { scope } = session.plan;

  if (
    scope.vertices.some((entry) => entry.vertex === vertex) ||
    scope.impactFlows.includes(vertex)
  ) {
    return { ok: true };
  }
  const pruned = scope.pruned.find((entry) => entry.vertex === vertex);

  if (pruned === undefined) {
    return {
      ok: false,
      message: `${vertex} is neither in scope nor pruned from it, so it is out of reach`,
    };
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    return {
      ok: false,
      message: `${vertex} was pruned (${pruned.reason}); give a reason to look at it anyway`,
    };
  }
  session.reachedPruned.push({ vertex, reason: reason.trim() });
  return { ok: true };
}
