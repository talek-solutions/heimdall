import type { ManifestApiVersion, ManifestKind } from '../../enums';

export interface IResourceMetadataV1 {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
}

/** Metadata of every resource except the System itself. */
export interface ISystemScopedMetadataV1 extends IResourceMetadataV1 {
  /** Name of the System the resource belongs to. */
  readonly system: string;
}

export interface IResourceV1<K extends ManifestKind, M extends IResourceMetadataV1, S> {
  readonly apiVersion: ManifestApiVersion.V1;
  readonly kind: K;
  readonly metadata: M;
  readonly spec: S;
}
