import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IIndicatorV1, IManifestResourceV1, IManifestV1 } from '../../interfaces/v1';
import { qualify, splitReference, type ManifestIndexV1 } from '../../parsers/v1/manifest-index-v1';
import { issueAt, listNames } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

interface IAttachment {
  readonly resource: IManifestResourceV1;
  readonly path: string;
  /** The component an unqualified metric name resolves against, if any. */
  readonly owner?: string;
  readonly indicators: readonly IIndicatorV1[];
}

/**
 * Every metric an indicator names exists. Unqualified names resolve against the owning
 * component; functionalities, flows and steps own none, so they must write `component/metric`.
 */
export class IndicatorReferencesRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1, index: ManifestIndexV1): IManifestIssue[] {
    return this.attachments(manifest).flatMap(({ resource, path, owner, indicators }) =>
      indicators.flatMap((indicator, position) =>
        this.references(indicator).flatMap(([field, reference]) => {
          const problem = this.resolve(reference, owner, index);
          return problem === undefined
            ? []
            : [issueAt(resource, `${path}.${position}.${field}`, problem)];
        }),
      ),
    );
  }

  private attachments(manifest: IManifestV1): IAttachment[] {
    return [
      ...manifest.components.flatMap((component) => {
        const owner = component.metadata.name;
        const members = component.spec.topology?.members ?? [];

        return [
          {
            resource: component,
            path: 'spec.indicators',
            owner,
            indicators: component.spec.indicators,
          },
          ...members.map((member, position) => ({
            resource: component,
            path: `spec.topology.members.${position}.indicators`,
            owner,
            indicators: member.indicators,
          })),
        ];
      }),
      ...manifest.functionalities.map((functionality) => ({
        resource: functionality,
        path: 'spec.indicators',
        indicators: functionality.spec.indicators,
      })),
      ...manifest.flows.flatMap((flow) => [
        { resource: flow, path: 'spec.indicators', indicators: flow.spec.indicators },
        ...flow.spec.steps.map((step, position) => ({
          resource: flow,
          path: `spec.steps.${position}.indicators`,
          indicators: step.indicators,
        })),
      ]),
    ];
  }

  private references(indicator: IIndicatorV1): (readonly [string, string])[] {
    if (indicator.ratio !== undefined) {
      return [
        ['ratio.numerator', indicator.ratio.numerator],
        ['ratio.denominator', indicator.ratio.denominator],
      ];
    }
    return indicator.metric === undefined ? [] : [['metric', indicator.metric]];
  }

  private resolve(
    reference: string,
    owner: string | undefined,
    index: ManifestIndexV1,
  ): string | undefined {
    const { component, name } = splitReference(reference);
    const emitter = component ?? owner;

    if (emitter === undefined) {
      return `'${reference}' must name its component as component/metric; nothing owns this indicator`;
    }
    const emitting = index.component(emitter);

    if (emitting === undefined) {
      return `unknown component '${emitter}'; declared components are ${listNames(index.componentNames())}`;
    }
    if (index.metric(qualify(emitter, name)) === undefined) {
      return `${emitter} declares no metric '${name}'; its metrics are ${listNames(emitting.spec.metrics.map((metric) => metric.name))}`;
    }
    return undefined;
  }
}
