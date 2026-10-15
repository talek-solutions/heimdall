import type { LabelSemantic } from '../../enums';
import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IManifestV1, IMetricDefinitionV1 } from '../../interfaces/v1';
import { issueAt } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

/** A meaning names at most one label of a metric, so a selector on it names exactly one label. */
export class MetricLabelsRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1): IManifestIssue[] {
    return manifest.components.flatMap((component) =>
      component.spec.metrics.flatMap(({ labels }, position) =>
        this.shared(labels).map(([meaning, names]) =>
          issueAt(
            component,
            `spec.metrics.${position}.labels`,
            `labels ${names.join(', ')} share the meaning ${meaning}; a selector on ${meaning} needs exactly one label`,
          ),
        ),
      ),
    );
  }

  private shared(labels: IMetricDefinitionV1['labels']): [LabelSemantic, string[]][] {
    const byMeaning = new Map<LabelSemantic, string[]>();

    for (const [label, meaning] of Object.entries(labels)) {
      byMeaning.set(meaning, [...(byMeaning.get(meaning) ?? []), label]);
    }
    return [...byMeaning].filter(([, names]) => names.length > 1);
  }
}
