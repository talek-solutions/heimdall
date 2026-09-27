import type {
  IComponentV1,
  IDependencyV1,
  IFlowV1,
  IManifestV1,
  IMetricDefinitionV1,
} from '../../interfaces/v1';
import { REFERENCE_SEPARATOR } from '../../schema/v1';

export interface IReference {
  readonly component?: string | undefined;
  readonly name: string;
}

export function qualify(component: string, name: string): string {
  return `${component}${REFERENCE_SEPARATOR}${name}`;
}

export function splitReference(reference: string): IReference {
  const separator = reference.indexOf(REFERENCE_SEPARATOR);

  return separator === -1
    ? { name: reference }
    : { component: reference.slice(0, separator), name: reference.slice(separator + 1) };
}

/** Lookups keyed the way the manifest refers to things, so rules never rescan it. */
export class ManifestIndexV1 {
  private readonly components: ReadonlyMap<string, IComponentV1>;
  private readonly flows: ReadonlyMap<string, IFlowV1>;
  private readonly dependencies: ReadonlyMap<string, IDependencyV1>;
  private readonly metrics: ReadonlyMap<string, IMetricDefinitionV1>;

  constructor(manifest: IManifestV1) {
    this.components = new Map(
      manifest.components.map((component) => [component.metadata.name, component]),
    );
    this.flows = new Map(manifest.flows.map((flow) => [flow.metadata.name, flow]));
    this.dependencies = new Map(
      manifest.components.flatMap((component) =>
        component.spec.dependsOn.map((dependency) => [
          qualify(component.metadata.name, dependency.name),
          dependency,
        ]),
      ),
    );
    this.metrics = new Map(
      manifest.components.flatMap((component) =>
        component.spec.metrics.map((metric) => [
          qualify(component.metadata.name, metric.name),
          metric,
        ]),
      ),
    );
  }

  component(name: string): IComponentV1 | undefined {
    return this.components.get(name);
  }

  componentNames(): readonly string[] {
    return [...this.components.keys()];
  }

  flow(name: string): IFlowV1 | undefined {
    return this.flows.get(name);
  }

  flowNames(): readonly string[] {
    return [...this.flows.keys()];
  }

  /** `component/dependency`. */
  dependency(reference: string): IDependencyV1 | undefined {
    return this.dependencies.get(reference);
  }

  /** `component/metric`. */
  metric(reference: string): IMetricDefinitionV1 | undefined {
    return this.metrics.get(reference);
  }
}
