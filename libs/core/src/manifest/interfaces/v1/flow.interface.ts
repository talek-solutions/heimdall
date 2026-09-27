import type { InteractionMode, LabelSemantic, ManifestKind } from '../../enums';
import type { IIndicatorV1 } from './indicator.interface';
import type { IResourceV1, ISystemScopedMetadataV1 } from './resource.interface';

export interface IFlowStepV1 {
  /** `component/dependency`: the dependency this step travels over. */
  readonly dependency: string;
  /** Narrows the dependency's metrics to this step, by label meaning. */
  readonly match: Readonly<Partial<Record<LabelSemantic, string>>>;
  readonly indicators: readonly IIndicatorV1[];
  readonly description?: string | undefined;
}

export interface IFlowSpecV1 {
  readonly description?: string | undefined;
  readonly mode: InteractionMode;
  /** False when a hop drops trace context, so signals are joined on `correlationKey`. */
  readonly propagatesTraceContext: boolean;
  readonly correlationKey?: string | undefined;
  /** In execution order. */
  readonly steps: readonly IFlowStepV1[];
  readonly indicators: readonly IIndicatorV1[];
}

export type IFlowV1 = IResourceV1<ManifestKind.Flow, ISystemScopedMetadataV1, IFlowSpecV1>;
