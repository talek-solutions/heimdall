import type { ComponentType, ManifestKind } from '../../enums';
import type { IDataModelEntryV1 } from './data-model.interface';
import type { IDependencyV1 } from './dependency.interface';
import type { IExposedInterfaceV1 } from './exposed-interface.interface';
import type { IIndicatorV1 } from './indicator.interface';
import type { IMetricDefinitionV1 } from './metric-definition.interface';
import type { IResourceV1, ISystemScopedMetadataV1 } from './resource.interface';
import type { ITelemetryIdentityV1 } from './telemetry.interface';
import type { ITopologyV1 } from './topology.interface';

export interface IComponentSpecV1 {
  readonly type: ComponentType;
  /** The technology behind it, e.g. `kafka`, `mysql`. */
  readonly engine?: string | undefined;
  readonly description?: string | undefined;
  readonly exposes: readonly IExposedInterfaceV1[];
  readonly telemetry: ITelemetryIdentityV1;
  readonly metrics: readonly IMetricDefinitionV1[];
  readonly indicators: readonly IIndicatorV1[];
  readonly dependsOn: readonly IDependencyV1[];
  readonly topology?: ITopologyV1 | undefined;
  readonly dataModel: readonly IDataModelEntryV1[];
}

export type IComponentV1 = IResourceV1<
  ManifestKind.Component,
  ISystemScopedMetadataV1,
  IComponentSpecV1
>;
