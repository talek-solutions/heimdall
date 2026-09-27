import type { ManifestKind } from '../../enums';
import type { IResourceMetadataV1, IResourceV1 } from './resource.interface';

export interface IEnvironmentV1 {
  readonly name: string;
  /** A context name in `~/.heimdall/config.yaml`; checked where both files are loaded. */
  readonly context: string;
  /** Added to every selector when querying this environment. */
  readonly labels: Readonly<Record<string, string>>;
}

export interface ISystemSpecV1 {
  readonly description?: string | undefined;
  readonly environments: readonly IEnvironmentV1[];
}

export type ISystemV1 = IResourceV1<ManifestKind.System, IResourceMetadataV1, ISystemSpecV1>;
