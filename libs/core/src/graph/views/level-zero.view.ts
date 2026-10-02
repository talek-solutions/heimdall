import { ExpectationKind, LabelSemantic } from '../../manifest/enums';
import type { IExpectationV1 } from '../../manifest/interfaces/v1';
import { EdgeType, VertexType } from '../enums';
import type {
  IComponentVertex,
  IDependencyVertex,
  IFlowPath,
  IIndicatorVertex,
  ISemanticSelector,
} from '../interfaces';
import type { SystemGraph } from '../system-graph';
import { vertexKey } from '../vertex-id';

const INDENT = '  ';
const STEP_SEPARATOR = ' ▸ ';

/** The order match values read naturally in: `POST /orders`, `INSERT orders`. */
const SELECTOR_ORDER: readonly LabelSemantic[] = [
  LabelSemantic.Method,
  LabelSemantic.Route,
  LabelSemantic.Operation,
  LabelSemantic.Table,
  LabelSemantic.Topic,
  LabelSemantic.ConsumerGroup,
  LabelSemantic.StatusCode,
  LabelSemantic.Outcome,
  LabelSemantic.Instance,
];

const PERCENTILES = ['p50', 'p90', 'p95', 'p99'] as const;

/**
 * Level 0 of the model view (ADR 0015): one line per functionality, flow, component and
 * member, each led by its vertex id so the model can answer with ids. Matchers, label names
 * and instance addresses never appear; they are for building queries, not for reasoning.
 */
export function renderLevelZero(graph: SystemGraph, environment?: string): string {
  const { system } = graph;
  const header = [
    `system ${system.name}`,
    ...(environment === undefined ? [] : [`env ${environment}`]),
  ].join(' · ');
  const lines = [system.description === undefined ? header : `${header} — ${system.description}`];
  const realised = new Set<string>();

  for (const functionality of graph.ofType(VertexType.Functionality)) {
    const kpis = graph.indicatorsOf(functionality.id).map(describeIndicator);
    lines.push(
      [
        functionality.id,
        withDescription(functionality.description),
        kpis.length === 0 ? '' : ` | ${kpis.join(', ')}`,
      ].join(''),
    );

    for (const path of graph.path(functionality.id)) {
      realised.add(path.flow.id);
      lines.push(`${INDENT}${describeFlow(path)}`);
    }
  }
  for (const flow of graph.ofType(VertexType.Flow).filter(({ id }) => !realised.has(id))) {
    graph.path(flow.id).forEach((path) => lines.push(describeFlow(path)));
  }
  for (const component of graph.ofType(VertexType.Component)) {
    lines.push(describeComponent(graph, component));

    for (const edge of graph.incoming(component.id, EdgeType.MemberOf)) {
      const member = graph.vertexOfType(edge.from, VertexType.Member);

      if (member !== undefined) {
        lines.push(`${INDENT}${member.id}  ${member.role}`);
      }
    }
  }
  const offFlow = graph
    .ofType(VertexType.Dependency)
    .filter(({ id }) => graph.incoming(id, EdgeType.Over).length === 0)
    .map(({ id }) => id);

  if (offFlow.length > 0) {
    lines.push(`not on any flow: ${offFlow.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function describeSelector(selector: ISemanticSelector): string {
  return SELECTOR_ORDER.flatMap((semantic) => {
    const value = selector[semantic];
    return value === undefined ? [] : [value];
  }).join(' ');
}

export function describeExpectation(expect: IExpectationV1): string {
  switch (expect.kind) {
    case ExpectationKind.Baseline:
      return '~baseline';
    case ExpectationKind.NonZero:
      return '>0';
    case ExpectationKind.Slo:
      return `slo ${bounds(
        expect.min,
        expect.max,
        PERCENTILES.map((key) => [key, expect[key]] as const),
      )}`;
    case ExpectationKind.Threshold:
      return `threshold ${bounds(expect.min, expect.max, [])}`;
  }
}

export function describeIndicator(indicator: IIndicatorVertex): string {
  const metric =
    indicator.metric ??
    (indicator.ratio === undefined
      ? '(query)'
      : `${indicator.ratio.numerator} / ${indicator.ratio.denominator}`);
  const selector = describeSelector(indicator.selector);

  return [
    indicator.roles.join('/'),
    selector === '' ? metric : `${metric} {${selector}}`,
    describeExpectation(indicator.expect),
  ].join(' ');
}

function describeFlow({ flow, steps }: IFlowPath): string {
  const traits = [
    flow.mode,
    ...(flow.propagatesTraceContext ? [] : ['no trace context']),
    ...(flow.correlationKey === undefined ? [] : [`join on ${flow.correlationKey}`]),
  ].join(', ');
  const hops = steps.map((step) => {
    const values = describeSelector(step.match);
    const dependency = vertexKey(step.dependency);
    return values === '' ? dependency : `${dependency} ${values}`;
  });

  return `${flow.id}  ${traits}: ${hops.join(STEP_SEPARATOR)}${withDescription(flow.description)}`;
}

function describeComponent(graph: SystemGraph, component: IComponentVertex): string {
  const kind =
    component.engine === undefined
      ? component.componentType
      : `${component.componentType} ${component.engine}`;
  const dependencies = graph.outgoing(component.id, EdgeType.Calls).flatMap((edge) => {
    const dependency = graph.vertexOfType(edge.to, VertexType.Dependency);
    return dependency === undefined ? [] : [describeDependency(dependency)];
  });

  return [
    `${component.id}  ${kind}`,
    withDescription(component.description),
    dependencies.length === 0 ? '' : ` → ${dependencies.join(' · ')}`,
  ].join('');
}

function describeDependency(dependency: IDependencyVertex): string {
  return [
    dependency.target,
    dependency.transport,
    dependency.mode,
    dependency.criticality,
    ...(dependency.writeTo === undefined ? [] : [`w:${dependency.writeTo}`]),
    ...(dependency.readFrom === undefined ? [] : [`r:${dependency.readFrom}`]),
  ].join(' ');
}

function withDescription(description: string | undefined): string {
  return description === undefined ? '' : ` — ${description}`;
}

function bounds(
  min: number | undefined,
  max: number | undefined,
  percentiles: readonly (readonly [string, number | undefined])[],
): string {
  return [
    ...(min === undefined ? [] : [`≥${min}`]),
    ...(max === undefined ? [] : [`≤${max}`]),
    ...percentiles.flatMap(([key, value]) => (value === undefined ? [] : [`${key}≤${value}`])),
  ].join(' ');
}
