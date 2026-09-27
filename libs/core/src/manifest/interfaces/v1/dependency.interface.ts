import type {
  Criticality,
  InteractionMode,
  ManifestProvenance,
  ReplicaRouting,
  Transport,
} from '../../enums';

export type DependencyConfigValue = string | number | boolean;

/** Declared on the caller; referenced elsewhere as `caller/name`. */
export interface IDependencyV1 {
  readonly name: string;
  /** The component called. */
  readonly target: string;
  readonly transport: Transport;
  readonly mode: InteractionMode;
  readonly criticality: Criticality;
  readonly operations: readonly string[];
  readonly topic?: string | undefined;
  readonly consumerGroup?: string | undefined;
  /** How the dependency is used, e.g. `cache-aside`. */
  readonly role?: string | undefined;
  readonly writeTo?: ReplicaRouting | undefined;
  readonly readFrom?: ReplicaRouting | undefined;
  /** Client settings that matter when reasoning about failures: timeouts, pools, TTLs. */
  readonly config: Readonly<Record<string, DependencyConfigValue>>;
  readonly provenance: ManifestProvenance;
  readonly description?: string | undefined;
}
