import type {
  IndicatorRole,
  LabelSemantic,
  ManifestProvenance,
  MetricType,
  Transport,
} from '../../enums';

/** Exactly one is set: traffic received over a transport, or a named outbound dependency. */
export interface IMeasuresV1 {
  readonly inbound?: Transport | undefined;
  readonly outbound?: string | undefined;
}

export interface IMetricDefinitionV1 {
  readonly name: string;
  readonly type: MetricType;
  readonly unit?: string | undefined;
  /** Overrides the role otherwise inferred from the metric type. */
  readonly role?: IndicatorRole | undefined;
  readonly measures?: IMeasuresV1 | undefined;
  /** Label name → what it means. */
  readonly labels: Readonly<Record<string, LabelSemantic>>;
  readonly provenance: ManifestProvenance;
  readonly description?: string | undefined;
}
