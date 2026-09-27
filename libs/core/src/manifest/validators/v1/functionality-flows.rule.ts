import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestV1 } from '../../interfaces/v1';
import type { ManifestIndexV1 } from '../../parsers/v1/manifest-index-v1';
import { issueAt, listNames } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

export class FunctionalityFlowsRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1, index: ManifestIndexV1): IManifestIssue[] {
    return manifest.functionalities.flatMap((functionality) =>
      functionality.spec.flows.flatMap((flow, position) =>
        index.flow(flow) === undefined
          ? [
              issueAt(
                functionality,
                `spec.flows.${position}`,
                `unknown flow '${flow}'; declared flows are ${listNames(index.flowNames())}`,
              ),
            ]
          : [],
      ),
    );
  }
}
