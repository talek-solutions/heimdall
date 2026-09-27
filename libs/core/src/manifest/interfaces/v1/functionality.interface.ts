import type { ManifestKind } from '../../enums';
import type { IIndicatorV1 } from './indicator.interface';
import type { IResourceV1, ISystemScopedMetadataV1 } from './resource.interface';

/** A business capability, realised by flows and measured by KPIs. */
export interface IFunctionalitySpecV1 {
  readonly description?: string | undefined;
  readonly flows: readonly string[];
  readonly indicators: readonly IIndicatorV1[];
}

export type IFunctionalityV1 = IResourceV1<
  ManifestKind.Functionality,
  ISystemScopedMetadataV1,
  IFunctionalitySpecV1
>;
