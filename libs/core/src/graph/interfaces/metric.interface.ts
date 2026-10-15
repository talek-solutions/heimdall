import type { LabelSemantic, MetricType } from '../../manifest/enums';

/** A component's metric definition, kept so an indicator can be turned into a query (ADR 0015). */
export interface IMetricDefinition {
  /** `component/metric`, as indicators reference it. */
  readonly reference: string;
  /** The emitter, whose telemetry identity locates the series; not the indicator's subject. */
  readonly component: string;
  readonly name: string;
  readonly type: MetricType;
  readonly unit?: string | undefined;
  /** Label name → what it means. */
  readonly labels: Readonly<Record<string, LabelSemantic>>;
}
