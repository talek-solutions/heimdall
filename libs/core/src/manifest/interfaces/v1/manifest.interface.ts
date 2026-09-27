import type { ManifestApiVersion } from '../../enums';
import type { IComponentV1 } from './component.interface';
import type { IFlowV1 } from './flow.interface';
import type { IFunctionalityV1 } from './functionality.interface';
import type { ISystemV1 } from './system.interface';

export type IManifestResourceV1 = ISystemV1 | IComponentV1 | IFunctionalityV1 | IFlowV1;

/** One manifest file describes one system. */
export interface IManifestV1 {
  readonly apiVersion: ManifestApiVersion.V1;
  readonly system: ISystemV1;
  readonly components: readonly IComponentV1[];
  readonly functionalities: readonly IFunctionalityV1[];
  readonly flows: readonly IFlowV1[];
}
