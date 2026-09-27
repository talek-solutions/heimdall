import { MemberRole, TopologyMode } from '../../enums';
import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IComponentV1, IManifestV1, ITopologyV1 } from '../../interfaces/v1';
import { issueAt } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

export class TopologyRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1): IManifestIssue[] {
    return manifest.components.flatMap((component) =>
      component.spec.topology === undefined ? [] : this.check(component, component.spec.topology),
    );
  }

  private check(component: IComponentV1, topology: ITopologyV1): IManifestIssue[] {
    if (topology.mode !== TopologyMode.PrimaryReplica) {
      return topology.replication === undefined
        ? []
        : [
            issueAt(
              component,
              'spec.topology.replication',
              `replication only applies to a ${TopologyMode.PrimaryReplica} topology`,
            ),
          ];
    }
    const primaries = topology.members.filter((member) => member.role === MemberRole.Primary);

    return primaries.length === 1
      ? []
      : [
          issueAt(
            component,
            'spec.topology.members',
            `a ${TopologyMode.PrimaryReplica} topology needs exactly one ${MemberRole.Primary} member; found ${primaries.length}`,
          ),
        ];
  }
}
