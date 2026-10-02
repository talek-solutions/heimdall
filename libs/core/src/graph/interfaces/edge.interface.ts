import type { EdgeType } from '../enums';

export interface IGraphEdge {
  readonly type: EdgeType;
  /** The dependent vertex. */
  readonly from: string;
  /** The vertex it depends on. */
  readonly to: string;
}
