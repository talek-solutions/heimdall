import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestV1 } from '../../interfaces/v1';
import type { ManifestIndexV1 } from '../../parsers/v1/manifest-index-v1';
import { issueAt, listNames } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

export class DependencyTargetRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1, index: ManifestIndexV1): IManifestIssue[] {
    return manifest.components.flatMap((component) =>
      component.spec.dependsOn.flatMap(({ target }, position) =>
        index.component(target) === undefined
          ? [
              issueAt(
                component,
                `spec.dependsOn.${position}.target`,
                `unknown component '${target}'; declared components are ${listNames(index.componentNames())}`,
              ),
            ]
          : [],
      ),
    );
  }
}
