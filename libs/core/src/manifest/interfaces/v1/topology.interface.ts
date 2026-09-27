import type { MemberRole, ReplicationMode, TopologyMode } from '../../enums';
import type { IIndicatorV1 } from './indicator.interface';
import type { ITelemetryIdentityV1 } from './telemetry.interface';

export interface IMemberV1 {
  readonly name: string;
  readonly role: MemberRole;
  readonly telemetry: ITelemetryIdentityV1;
  readonly indicators: readonly IIndicatorV1[];
}

export interface ITopologyV1 {
  readonly mode: TopologyMode;
  /** Only with `primary-replica`. */
  readonly replication?: ReplicationMode | undefined;
  readonly members: readonly IMemberV1[];
}
