import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestResourceV1, IManifestV1 } from '../../interfaces/v1';
import { issueAt } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

/** Names that other parts of the manifest refer to must be unique within their parent. */
export class UniqueNamesRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1): IManifestIssue[] {
    const { system, components } = manifest;

    return [
      ...this.duplicates(system, 'spec.environments', system.spec.environments, 'environment'),
      ...components.flatMap((component) => [
        ...this.duplicates(component, 'spec.dependsOn', component.spec.dependsOn, 'dependency'),
        ...this.duplicates(component, 'spec.metrics', component.spec.metrics, 'metric'),
        ...this.duplicates(
          component,
          'spec.topology.members',
          component.spec.topology?.members ?? [],
          'member',
        ),
      ]),
    ];
  }

  private duplicates(
    resource: IManifestResourceV1,
    path: string,
    entries: readonly { readonly name: string }[],
    noun: string,
  ): IManifestIssue[] {
    const seen = new Set<string>();

    return entries.flatMap(({ name }, index) => {
      if (!seen.has(name)) {
        seen.add(name);
        return [];
      }
      return [issueAt(resource, `${path}.${index}.name`, `duplicate ${noun} name '${name}'`)];
    });
  }
}
