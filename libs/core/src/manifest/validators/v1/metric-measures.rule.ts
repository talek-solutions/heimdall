import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IComponentV1, IManifestV1, IMeasuresV1 } from '../../interfaces/v1';
import { issueAt, listNames } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

/** A metric measures an outbound dependency of its own component, or a transport it serves. */
export class MetricMeasuresRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1): IManifestIssue[] {
    return manifest.components.flatMap((component) =>
      component.spec.metrics.flatMap(({ measures }, position) =>
        measures === undefined
          ? []
          : this.check(component, measures, `spec.metrics.${position}.measures`),
      ),
    );
  }

  private check(component: IComponentV1, measures: IMeasuresV1, path: string): IManifestIssue[] {
    const { name } = component.metadata;
    const { dependsOn, exposes } = component.spec;

    if (
      measures.outbound !== undefined &&
      !dependsOn.some((entry) => entry.name === measures.outbound)
    ) {
      return [
        issueAt(
          component,
          `${path}.outbound`,
          `'${measures.outbound}' is not a dependency of ${name}; its dependencies are ${listNames(dependsOn.map((entry) => entry.name))}`,
        ),
      ];
    }
    if (
      measures.inbound !== undefined &&
      !exposes.some((entry) => entry.transport === measures.inbound)
    ) {
      return [
        issueAt(
          component,
          `${path}.inbound`,
          `${name} does not expose ${measures.inbound}; it exposes ${listNames(exposes.map((entry) => entry.transport))}`,
        ),
      ];
    }
    return [];
  }
}
