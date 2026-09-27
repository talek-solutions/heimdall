import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ComponentType,
  Criticality,
  ExpectationKind,
  IndicatorRole,
  InteractionMode,
  ManifestApiVersion,
  ManifestKind,
  ManifestProvenance,
  MetricType,
  Transport,
} from '../enums';
import type { IManifestIssue } from '../interfaces/manifest-issue.interface';
import type {
  IComponentSpecV1,
  IComponentV1,
  IDependencyV1,
  IFlowSpecV1,
  IFlowStepV1,
  IFlowV1,
  IFunctionalitySpecV1,
  IFunctionalityV1,
  IIndicatorV1,
  IManifestV1,
  IMetricDefinitionV1,
  ISystemSpecV1,
  ISystemV1,
} from '../interfaces/v1';
import { ManifestIndexV1 } from '../parsers/v1/manifest-index-v1';
import { ManifestV1Parser } from '../parsers/v1/manifest-v1.parser';
import { ManifestReader } from '../manifest.reader';
import type { IManifestRuleV1 } from '../validators/v1';

export const SYSTEM = 'shop';

const SHOP_MANIFEST = join('.docs', 'manifests', 'shop', 'manifest.yaml');

/** One System and one Component: the smallest manifest that parses. */
export const MINIMAL_MANIFEST = `
apiVersion: heimdall/v1
kind: System
metadata: { name: shop }
spec: {}
---
apiVersion: heimdall/v1
kind: Component
metadata: { name: api, system: shop }
spec:
  type: service
  metrics:
    - { name: errors_total, type: counter }
  indicators:
    - { metric: errors_total, role: errors }
`;

/** The ADR 0015 reference manifest. Specs run from `dist`, so walk up to the repository. */
export function readShopManifest(): string {
  let directory = __dirname;

  while (!existsSync(join(directory, SHOP_MANIFEST))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`${SHOP_MANIFEST} not found above ${__dirname}`);
    }
    directory = parent;
  }
  return readFileSync(join(directory, SHOP_MANIFEST), 'utf8');
}

/** Parsed resources are schema class instances; compare them as the JSON they came from. */
export function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function createReader(): ManifestReader {
  return new ManifestReader(new ManifestV1Parser());
}

export function systemV1(spec: Partial<ISystemSpecV1> = {}): ISystemV1 {
  return {
    apiVersion: ManifestApiVersion.V1,
    kind: ManifestKind.System,
    metadata: { name: SYSTEM, labels: {}, annotations: {} },
    spec: { environments: [], ...spec },
  };
}

export function componentV1(name: string, spec: Partial<IComponentSpecV1> = {}): IComponentV1 {
  return {
    apiVersion: ManifestApiVersion.V1,
    kind: ManifestKind.Component,
    metadata: { name, system: SYSTEM, labels: {}, annotations: {} },
    spec: {
      type: ComponentType.Service,
      exposes: [],
      telemetry: {},
      metrics: [],
      indicators: [],
      dependsOn: [],
      dataModel: [],
      ...spec,
    },
  };
}

export function functionalityV1(
  name: string,
  spec: Partial<IFunctionalitySpecV1> = {},
): IFunctionalityV1 {
  return {
    apiVersion: ManifestApiVersion.V1,
    kind: ManifestKind.Functionality,
    metadata: { name, system: SYSTEM, labels: {}, annotations: {} },
    spec: { flows: [], indicators: [], ...spec },
  };
}

export function flowV1(name: string, spec: Partial<IFlowSpecV1> = {}): IFlowV1 {
  return {
    apiVersion: ManifestApiVersion.V1,
    kind: ManifestKind.Flow,
    metadata: { name, system: SYSTEM, labels: {}, annotations: {} },
    spec: {
      mode: InteractionMode.Sync,
      propagatesTraceContext: true,
      steps: [],
      indicators: [],
      ...spec,
    },
  };
}

export function stepV1(dependency: string, overrides: Partial<IFlowStepV1> = {}): IFlowStepV1 {
  return { dependency, match: {}, indicators: [], ...overrides };
}

export function dependencyV1(
  name: string,
  target: string,
  overrides: Partial<IDependencyV1> = {},
): IDependencyV1 {
  return {
    name,
    target,
    transport: Transport.Http,
    mode: InteractionMode.Sync,
    criticality: Criticality.Hard,
    operations: [],
    config: {},
    provenance: ManifestProvenance.Declared,
    ...overrides,
  };
}

export function metricV1(
  name: string,
  overrides: Partial<IMetricDefinitionV1> = {},
): IMetricDefinitionV1 {
  return {
    name,
    type: MetricType.Counter,
    labels: {},
    provenance: ManifestProvenance.Declared,
    ...overrides,
  };
}

export function indicatorV1(overrides: Partial<IIndicatorV1> = {}): IIndicatorV1 {
  return {
    role: IndicatorRole.Errors,
    expect: { kind: ExpectationKind.Baseline },
    ...overrides,
  };
}

export function manifestV1(parts: Partial<Omit<IManifestV1, 'apiVersion'>> = {}): IManifestV1 {
  return {
    apiVersion: ManifestApiVersion.V1,
    system: systemV1(),
    components: [],
    functionalities: [],
    flows: [],
    ...parts,
  };
}

export function runRule(rule: IManifestRuleV1, manifest: IManifestV1): IManifestIssue[] {
  return rule.validate(manifest, new ManifestIndexV1(manifest));
}
