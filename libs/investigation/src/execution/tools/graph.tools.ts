import { ToolAccess, toolError, toolOk, type IAgentTool } from '@heimdall/agent';
import { describeIndicator, EdgeType, VertexType, type IGraphVertex } from '@heimdall/core/graph';
import { InvestigationErrorCode } from '../../errors';
import type { ExecutionSession } from '../execution.session';
import { InvestigationTool } from './investigation-tool.enum';
import { invalid, nonEmptyString, object } from './tool-input';

const MAX_HOPS = 2;

export interface IVertexInput {
  readonly vertex: string;
}

export interface ISubgraphInput extends IVertexInput {
  readonly hops: number;
}

const VERTEX_SCHEMA = {
  type: 'string',
  description: 'A vertex id, e.g. component:checkout or step:place-order#3',
} as const;

/** Graph lookups (ADR 0015, level 1): the manifest only, no telemetry, so no reach rule. */
export function graphTools(session: ExecutionSession): IAgentTool[] {
  const { graph } = session;
  const parseVertex = (input: unknown) => {
    const vertex = object(input)?.['vertex'];
    return nonEmptyString(vertex)
      ? { ok: true as const, input: { vertex } }
      : invalid<IVertexInput>('vertex must be a vertex id');
  };
  const known = (id: string): IGraphVertex | undefined => graph.vertex(id);
  const unknown = (id: string) =>
    toolError(InvestigationErrorCode.UnknownVertex, `no vertex is called ${id}`);

  const describe: IAgentTool<IVertexInput> = {
    name: InvestigationTool.DescribeVertex,
    description:
      'Describe one vertex: its properties, its indicators (with ids for check_indicator), its edges, and whether it is in scope.',
    inputSchema: { type: 'object', properties: { vertex: VERTEX_SCHEMA }, required: ['vertex'] },
    access: ToolAccess.ReadOnly,
    parse: parseVertex,
    execute: async ({ vertex: id }) => {
      const vertex = known(id);

      if (vertex === undefined) {
        return unknown(id);
      }
      const scoped = session.plan.scope.vertices.find((entry) => entry.vertex === id);
      const pruned = session.plan.scope.pruned.find((entry) => entry.vertex === id);

      return toolOk(
        {
          vertex: properties(vertex),
          scope:
            scoped?.reason ?? (pruned === undefined ? 'out of reach' : `pruned: ${pruned.reason}`),
          indicators: graph.indicatorsOf(id).map((indicator) => ({
            id: indicator.id,
            describe: describeIndicator(indicator),
            planned: session.plan.checks
              .filter((check) => check.indicator?.id === indicator.id)
              .map((check) => check.id),
          })),
          outgoing: graph
            .outgoing(id)
            .filter((edge) => edge.type !== EdgeType.Measures)
            .map((edge) => `${edge.type} → ${edge.to}`),
          incoming: graph
            .incoming(id)
            .filter((edge) => edge.type !== EdgeType.Measures)
            .map((edge) => `${edge.from} → ${edge.type}`),
        },
        `described ${id}`,
      );
    },
  };

  const subgraph: IAgentTool<ISubgraphInput> = {
    name: InvestigationTool.Subgraph,
    description: 'The vertices and edges within 1 or 2 hops of a vertex, indicators left out.',
    inputSchema: {
      type: 'object',
      properties: { vertex: VERTEX_SCHEMA, hops: { type: 'integer', enum: [1, 2] } },
      required: ['vertex', 'hops'],
    },
    access: ToolAccess.ReadOnly,
    parse: (input) => {
      const fields = object(input);
      const vertex = fields?.['vertex'];
      const hops = fields?.['hops'];

      if (!nonEmptyString(vertex)) {
        return invalid('vertex must be a vertex id');
      }
      return hops === 1 || hops === MAX_HOPS
        ? { ok: true, input: { vertex, hops } }
        : invalid(`hops must be 1 or ${MAX_HOPS}`);
    },
    execute: async ({ vertex: id, hops }) => {
      if (known(id) === undefined) {
        return unknown(id);
      }
      const { vertices, edges } = graph.subgraph(id, hops);

      return toolOk(
        {
          vertices: vertices.map((vertex) => ({ id: vertex, type: graph.vertex(vertex)?.type })),
          edges: edges.map((edge) => `${edge.from} ${edge.type} ${edge.to}`),
        },
        `${vertices.length} vertices within ${hops} of ${id}`,
      );
    },
  };

  const impact: IAgentTool<IVertexInput> = {
    name: InvestigationTool.Impact,
    description: 'What depends on a vertex, up to the flows and functionalities it can break.',
    inputSchema: { type: 'object', properties: { vertex: VERTEX_SCHEMA }, required: ['vertex'] },
    access: ToolAccess.ReadOnly,
    parse: parseVertex,
    execute: async ({ vertex: id }) =>
      known(id) === undefined ? unknown(id) : toolOk(graph.impact(id), `impact of ${id}`),
  };

  return [describe, subgraph, impact];
}

/** A vertex without its telemetry identity: the agent never sees matchers (ADR 0015). */
function properties(vertex: IGraphVertex): Record<string, unknown> {
  if (vertex.type !== VertexType.Component && vertex.type !== VertexType.Member) {
    return { ...vertex };
  }
  const { telemetry, ...rest } = vertex;

  return {
    ...rest,
    signals: Object.entries(telemetry)
      .filter(([, identity]) => identity !== undefined)
      .map(([signal]) => signal),
  };
}
