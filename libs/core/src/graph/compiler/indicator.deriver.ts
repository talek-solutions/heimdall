import { ExpectationKind, IndicatorRole, LabelSemantic, MetricType } from '../../manifest/enums';
import type {
  IComponentV1,
  IFlowStepV1,
  IIndicatorV1,
  IManifestV1,
  IMetricDefinitionV1,
} from '../../manifest/interfaces/v1';
import {
  ManifestIndexV1,
  qualify,
  splitReference,
} from '../../manifest/parsers/v1/manifest-index-v1';
import { IndicatorProvenance } from '../enums';
import type { IIndicatorVertex, ISemanticSelector } from '../interfaces';
import { VertexIds } from '../vertex-id';

export type IIndicatorDraft = Omit<IIndicatorVertex, 'id' | 'type'>;

const EMPTY_SELECTOR: ISemanticSelector = {};
const ERROR_SEMANTICS: ReadonlySet<LabelSemantic> = new Set([
  LabelSemantic.StatusCode,
  LabelSemantic.Outcome,
]);
const DISTRIBUTIONS: ReadonlySet<MetricType> = new Set([MetricType.Histogram, MetricType.Summary]);

/**
 * Declared indicators, qualified, plus the ones the manifest implies (the derivation rules in
 * `.docs/manifests/shop/README.md`). Users declare only what cannot be inferred.
 */
export class IndicatorDeriver {
  derive(manifest: IManifestV1): IIndicatorDraft[] {
    const index = new ManifestIndexV1(manifest);

    return [
      ...manifest.functionalities.flatMap((functionality) =>
        this.declared(
          VertexIds.functionality(functionality.metadata.name),
          functionality.spec.indicators,
          undefined,
          EMPTY_SELECTOR,
        ),
      ),
      ...manifest.flows.flatMap((flow) =>
        this.declared(
          VertexIds.flow(flow.metadata.name),
          flow.spec.indicators,
          undefined,
          EMPTY_SELECTOR,
        ),
      ),
      ...manifest.flows.flatMap((flow) =>
        flow.spec.steps.flatMap((step, offset) =>
          this.forStep(VertexIds.step(flow.metadata.name, offset + 1), step, index),
        ),
      ),
      ...manifest.components.flatMap((component) => this.forComponent(component)),
      ...manifest.components.flatMap((component) =>
        (component.spec.topology?.members ?? []).flatMap((member) =>
          this.declared(
            VertexIds.member(component.metadata.name, member.name),
            member.indicators,
            component.metadata.name,
            EMPTY_SELECTOR,
          ),
        ),
      ),
    ];
  }

  private forStep(subject: string, step: IFlowStepV1, index: ManifestIndexV1): IIndicatorDraft[] {
    const declared = this.declared(subject, step.indicators, undefined, step.match);
    const dependency = index.dependency(step.dependency);
    const caller = splitReference(step.dependency).component;

    if (dependency === undefined || caller === undefined) {
      return declared;
    }
    const outbound = (index.component(caller)?.spec.metrics ?? [])
      .filter((metric) => metric.measures?.outbound === dependency.name)
      .map((metric) => ({ owner: caller, metric }));
    const inbound = (index.component(dependency.target)?.spec.metrics ?? [])
      .filter((metric) => metric.measures?.inbound === dependency.transport)
      .map((metric) => ({ owner: dependency.target, metric }));
    const derived = [...outbound, ...inbound]
      .filter(({ metric }) => this.covers(metric, step.match))
      .flatMap(({ owner, metric }) =>
        this.derived(subject, qualify(owner, metric.name), metric, step.match, declared),
      );

    return [...declared, ...derived];
  }

  private forComponent(component: IComponentV1): IIndicatorDraft[] {
    const name = component.metadata.name;
    const subject = VertexIds.component(name);
    const declared = this.declared(subject, component.spec.indicators, name, EMPTY_SELECTOR);
    const derived = component.spec.metrics
      .filter(
        (metric) =>
          metric.measures?.inbound !== undefined ||
          (metric.role !== undefined && metric.measures === undefined),
      )
      .flatMap((metric) =>
        this.derived(subject, qualify(name, metric.name), metric, EMPTY_SELECTOR, declared),
      );

    return [...declared, ...derived];
  }

  private declared(
    subject: string,
    indicators: readonly IIndicatorV1[],
    owner: string | undefined,
    selector: ISemanticSelector,
  ): IIndicatorDraft[] {
    return indicators.map((indicator) => ({
      subject,
      metric: indicator.metric === undefined ? undefined : this.qualified(indicator.metric, owner),
      ratio:
        indicator.ratio === undefined
          ? undefined
          : {
              numerator: this.qualified(indicator.ratio.numerator, owner),
              denominator: this.qualified(indicator.ratio.denominator, owner),
            },
      roles: [indicator.role],
      expect: indicator.expect,
      selector,
      provenance: IndicatorProvenance.Declared,
      query: indicator.query,
      description: indicator.description,
    }));
  }

  // A declared indicator for the same subject and metric suppresses the derived one.
  private derived(
    subject: string,
    metric: string,
    definition: IMetricDefinitionV1,
    selector: ISemanticSelector,
    declared: readonly IIndicatorDraft[],
  ): IIndicatorDraft[] {
    const roles = this.rolesOf(definition);

    if (roles.length === 0 || declared.some((indicator) => indicator.metric === metric)) {
      return [];
    }
    return [
      {
        subject,
        metric,
        roles,
        expect: { kind: ExpectationKind.Baseline },
        selector,
        provenance: IndicatorProvenance.Derived,
      },
    ];
  }

  private covers(metric: IMetricDefinitionV1, match: ISemanticSelector): boolean {
    const semantics = new Set(Object.values(metric.labels));
    return Object.keys(match).every((key) => semantics.has(key as LabelSemantic));
  }

  /** An explicit role wins; otherwise the metric type decides, and a gauge says nothing. */
  private rolesOf(metric: IMetricDefinitionV1): IndicatorRole[] {
    if (metric.role !== undefined) {
      return [metric.role];
    }
    if (metric.type === MetricType.Gauge) {
      return [];
    }
    const errors = Object.values(metric.labels).some((semantic) => ERROR_SEMANTICS.has(semantic));

    return [
      IndicatorRole.Throughput,
      ...(errors ? [IndicatorRole.Errors] : []),
      ...(DISTRIBUTIONS.has(metric.type) ? [IndicatorRole.Latency] : []),
    ];
  }

  private qualified(reference: string, owner: string | undefined): string {
    return splitReference(reference).component !== undefined || owner === undefined
      ? reference
      : qualify(owner, reference);
  }
}
