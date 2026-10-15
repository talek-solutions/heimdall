import type { LabelSemantic } from '../../enums';
import type { IManifestIssue } from '../../interfaces/manifest-issue.interface';
import type { IFlowStepV1, IManifestV1, IMetricDefinitionV1 } from '../../interfaces/v1';
import type { ManifestIndexV1 } from '../../parsers/v1/manifest-index-v1';
import { indicatorMetrics } from './indicator-metrics';
import { issueAt } from './issue-at';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';

/**
 * A declared step indicator is narrowed by the step's `match`, so every metric it reads labels
 * each meaning the step matches on, unless the indicator brings its own query. Metrics that do
 * not resolve are IndicatorReferencesRule's to report.
 */
export class StepIndicatorLabelsRule implements IManifestRuleV1 {
  validate(manifest: IManifestV1, index: ManifestIndexV1): IManifestIssue[] {
    return manifest.flows.flatMap((flow) =>
      flow.spec.steps.flatMap((step, stepPosition) =>
        step.indicators.flatMap((indicator, position) =>
          indicator.query !== undefined
            ? []
            : indicatorMetrics(indicator).flatMap(([field, reference]) => {
                const missing = this.unlabelled(index.metric(reference), step.match);

                return missing.length === 0
                  ? []
                  : [
                      issueAt(
                        flow,
                        `spec.steps.${stepPosition}.indicators.${position}.${field}`,
                        `${reference} has no label meaning ${missing.join(', ')}, which the step matches on; label the metric or give the indicator a query`,
                      ),
                    ];
              }),
        ),
      ),
    );
  }

  private unlabelled(
    metric: IMetricDefinitionV1 | undefined,
    match: IFlowStepV1['match'],
  ): LabelSemantic[] {
    if (metric === undefined) {
      return [];
    }
    const labelled = new Set(Object.values(metric.labels));
    return (Object.keys(match) as LabelSemantic[]).filter((meaning) => !labelled.has(meaning));
  }
}
