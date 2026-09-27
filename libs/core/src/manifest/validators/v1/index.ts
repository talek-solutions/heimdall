import { DependencyTargetRule } from './dependency-target.rule';
import { FlowStepsRule } from './flow-steps.rule';
import { FunctionalityFlowsRule } from './functionality-flows.rule';
import { IndicatorReferencesRule } from './indicator-references.rule';
import type { IManifestRuleV1 } from './manifest-rule-v1.interface';
import { MetricMeasuresRule } from './metric-measures.rule';
import { TopologyRule } from './topology.rule';
import { UniqueNamesRule } from './unique-names.rule';

export type { IManifestRuleV1 } from './manifest-rule-v1.interface';

export const MANIFEST_RULES_V1: readonly IManifestRuleV1[] = [
  new UniqueNamesRule(),
  new DependencyTargetRule(),
  new MetricMeasuresRule(),
  new TopologyRule(),
  new FunctionalityFlowsRule(),
  new FlowStepsRule(),
  new IndicatorReferencesRule(),
];
