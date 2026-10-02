import type { IGraphEdge } from './edge.interface';
import type { IFlowVertex, IStepVertex } from './vertex.interface';

export interface IFlowPath {
  readonly flow: IFlowVertex;
  /** In execution order. */
  readonly steps: readonly IStepVertex[];
}

export interface ISubgraph {
  readonly vertices: readonly string[];
  readonly edges: readonly IGraphEdge[];
}

export interface IImpact {
  /** Every vertex reached, excluding the start. */
  readonly vertices: readonly string[];
  readonly flows: readonly string[];
  readonly functionalities: readonly string[];
}
