import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestV1 } from '../../interfaces/v1';
import { splitReference, type ManifestIndexV1 } from '../../parsers/v1/manifest-index-v1';
import { issueAt, listNames } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

/** Every step travels over a dependency some component declares. */
export class FlowStepsRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1, index: ManifestIndexV1): IManifestIssue[] {
    return manifest.flows.flatMap((flow) =>
      flow.spec.steps.flatMap(({ dependency }, position) =>
        index.dependency(dependency) === undefined
          ? [issueAt(flow, `spec.steps.${position}.dependency`, this.describe(dependency, index))]
          : [],
      ),
    );
  }

  private describe(reference: string, index: ManifestIndexV1): string {
    const { component, name } = splitReference(reference);
    const caller = component === undefined ? undefined : index.component(component);

    if (caller === undefined) {
      return `unknown component '${component ?? reference}'; declared components are ${listNames(index.componentNames())}`;
    }
    return `${component} declares no dependency '${name}'; its dependencies are ${listNames(caller.spec.dependsOn.map((entry) => entry.name))}`;
  }
}
