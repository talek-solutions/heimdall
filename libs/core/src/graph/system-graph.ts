import type { IEnvironmentV1 } from '../manifest/interfaces/v1';
import { EdgeType, VertexType } from './enums';
import type {
  IFlowPath,
  IFlowVertex,
  IGraphEdge,
  IGraphVertex,
  IImpact,
  IIndicatorVertex,
  IStepVertex,
  ISubgraph,
  IVertexOfType,
} from './interfaces';

export interface ISystemInfo {
  readonly name: string;
  readonly description?: string | undefined;
  readonly environments: readonly IEnvironmentV1[];
}

/**
 * From a failing vertex, what else fails: whatever reaches it over these edges. Callers of a
 * dependency are not followed, so impact stays on the flows that travel over the fault
 * (ADR 0015's upward walk) rather than spreading through every caller's other work.
 */
const IMPACT_INCOMING: ReadonlySet<EdgeType> = new Set([
  EdgeType.Targets,
  EdgeType.Over,
  EdgeType.HasStep,
  EdgeType.RealizedBy,
]);

/** A failing member degrades its component; a failing primary, its replicas. */
const IMPACT_OUTGOING: ReadonlySet<EdgeType> = new Set([EdgeType.MemberOf, EdgeType.ReplicatesTo]);

const NO_EDGES: readonly IGraphEdge[] = [];

/** The compiled manifest (ADR 0015). Immutable; built by `SystemGraphCompiler`. */
export class SystemGraph {
  private readonly byId: ReadonlyMap<string, IGraphVertex>;
  private readonly outgoingById: ReadonlyMap<string, readonly IGraphEdge[]>;
  private readonly incomingById: ReadonlyMap<string, readonly IGraphEdge[]>;

  constructor(
    readonly system: ISystemInfo,
    readonly vertices: readonly IGraphVertex[],
    readonly edges: readonly IGraphEdge[],
  ) {
    this.byId = new Map(vertices.map((vertex) => [vertex.id, vertex]));
    this.outgoingById = this.group(edges, (edge) => edge.from);
    this.incomingById = this.group(edges, (edge) => edge.to);
  }

  vertex(id: string): IGraphVertex | undefined {
    return this.byId.get(id);
  }

  vertexOfType<T extends VertexType>(id: string, type: T): IVertexOfType<T> | undefined {
    const vertex = this.byId.get(id);
    return vertex?.type === type ? (vertex as IVertexOfType<T>) : undefined;
  }

  ofType<T extends VertexType>(type: T): IVertexOfType<T>[] {
    return this.vertices.filter((vertex): vertex is IVertexOfType<T> => vertex.type === type);
  }

  outgoing(id: string, type?: EdgeType): readonly IGraphEdge[] {
    const edges = this.outgoingById.get(id) ?? NO_EDGES;
    return type === undefined ? edges : edges.filter((edge) => edge.type === type);
  }

  incoming(id: string, type?: EdgeType): readonly IGraphEdge[] {
    const edges = this.incomingById.get(id) ?? NO_EDGES;
    return type === undefined ? edges : edges.filter((edge) => edge.type === type);
  }

  indicatorsOf(id: string): IIndicatorVertex[] {
    return this.incoming(id, EdgeType.Measures).flatMap((edge) => {
      const indicator = this.vertexOfType(edge.from, VertexType.Indicator);
      return indicator === undefined ? [] : [indicator];
    });
  }

  /** Ordered steps of a flow, or of every flow realising a functionality; empty otherwise. */
  path(id: string): IFlowPath[] {
    const vertex = this.byId.get(id);

    if (vertex?.type === VertexType.Flow) {
      return [this.flowPath(vertex)];
    }
    if (vertex?.type !== VertexType.Functionality) {
      return [];
    }
    return this.outgoing(id, EdgeType.RealizedBy).flatMap((edge) => {
      const flow = this.vertexOfType(edge.to, VertexType.Flow);
      return flow === undefined ? [] : [this.flowPath(flow)];
    });
  }

  /** Everything within `hops` of a vertex in either direction, indicators excluded. */
  subgraph(id: string, hops: number): ISubgraph {
    const depth = new Map<string, number>([[id, 0]]);
    const queue = [id];

    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      const distance = depth.get(current) ?? 0;

      if (distance === hops) {
        continue;
      }
      for (const edge of [...this.outgoing(current), ...this.incoming(current)]) {
        const neighbour = edge.from === current ? edge.to : edge.from;

        if (edge.type !== EdgeType.Measures && !depth.has(neighbour)) {
          depth.set(neighbour, distance + 1);
          queue.push(neighbour);
        }
      }
    }
    const vertices = [...depth.keys()];
    const edges = this.edges.filter(
      (edge) => edge.type !== EdgeType.Measures && depth.has(edge.from) && depth.has(edge.to),
    );
    return { vertices, edges };
  }

  /** What depends on a vertex, up to the flows and functionalities it can break. */
  impact(id: string): IImpact {
    const reached = new Set<string>([id]);
    const queue = [id];

    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      const next = [
        ...this.incoming(current)
          .filter((edge) => IMPACT_INCOMING.has(edge.type))
          .map((edge) => edge.from),
        ...this.outgoing(current)
          .filter((edge) => IMPACT_OUTGOING.has(edge.type))
          .map((edge) => edge.to),
      ];

      for (const vertex of next) {
        if (!reached.has(vertex)) {
          reached.add(vertex);
          queue.push(vertex);
        }
      }
    }
    reached.delete(id);
    const vertices = [...reached];

    return {
      vertices,
      flows: vertices.filter((vertex) => this.byId.get(vertex)?.type === VertexType.Flow),
      functionalities: vertices.filter(
        (vertex) => this.byId.get(vertex)?.type === VertexType.Functionality,
      ),
    };
  }

  private flowPath(flow: IFlowVertex): IFlowPath {
    const steps = this.outgoing(flow.id, EdgeType.HasStep)
      .flatMap((edge) => {
        const step = this.vertexOfType(edge.to, VertexType.Step);
        return step === undefined ? [] : [step];
      })
      .sort((left: IStepVertex, right: IStepVertex) => left.position - right.position);

    return { flow, steps };
  }

  private group(
    edges: readonly IGraphEdge[],
    key: (edge: IGraphEdge) => string,
  ): Map<string, IGraphEdge[]> {
    const grouped = new Map<string, IGraphEdge[]>();

    for (const edge of edges) {
      const bucket = grouped.get(key(edge));

      if (bucket === undefined) {
        grouped.set(key(edge), [edge]);
      } else {
        bucket.push(edge);
      }
    }
    return grouped;
  }
}
