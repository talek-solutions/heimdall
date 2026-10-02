import { Inject, Injectable } from '@nestjs/common';
import {
  describeSelector,
  EdgeType,
  vertexKey,
  VertexIds,
  VertexType,
  type IComponentVertex,
  type IDependencyVertex,
  type IFlowPath,
  type IIndicatorVertex,
  type IStepVertex,
  type SystemGraph,
} from '@heimdall/core/graph';
import { Criticality, IndicatorRole } from '@heimdall/core/manifest';
import type { IInvestigationConfig } from '../config/investigation-config.model';
import { BlindSpotReason, CheckKind, CheckTier, ScopeReason } from '../enums';
import type { IBlindSpot, ICheck, ICheckCondition, IInvestigationScope } from '../interfaces';
import { INVESTIGATION_CONFIG } from '../investigation.tokens';
import { CheckList } from './check.list';

export interface IPlannedChecks {
  readonly checks: readonly ICheck[];
  readonly blindSpots: readonly IBlindSpot[];
  readonly omittedChecks: number;
}

/** Causes show up differently from symptoms, so explaining also looks at exhaustion and backlog. */
const CAUSE_ROLES: readonly IndicatorRole[] = [IndicatorRole.Saturation, IndicatorRole.Lag];
const SATURATION: ReadonlySet<IndicatorRole> = new Set([IndicatorRole.Saturation]);
const BLIND_SPOT_TYPES: ReadonlySet<VertexType> = new Set([
  VertexType.Step,
  VertexType.Component,
  VertexType.Member,
]);

/** Filters an indicator's roles; `undefined` allows every role. */
type RoleFilter = ReadonlySet<IndicatorRole> | undefined;

/**
 * In what order to look, and at what (ADR 0016): confirm, localise, then explain and
 * corroborate behind the failing step, and report impact last.
 */
@Injectable()
export class CheckPlanner {
  constructor(@Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig) {}

  plan(
    graph: SystemGraph,
    entry: string,
    scope: IInvestigationScope,
    symptomRoles: readonly IndicatorRole[],
  ): IPlannedChecks {
    const list = new CheckList();
    const scoped = new Map(scope.vertices.map(({ vertex, reason }) => [vertex, reason]));
    const symptom: RoleFilter = new Set(symptomRoles);
    const causes: RoleFilter = new Set([...symptomRoles, ...CAUSE_ROLES]);
    const paths = scope.suspectFlows.flatMap((flow) => graph.path(flow));

    if (paths.length > 0) {
      this.confirmFlows(graph, scope, paths, list);
      this.localiseSteps(graph, paths, symptom, list);

      for (const { flow, steps } of paths) {
        for (const step of steps) {
          const dependency = graph.vertexOfType(step.dependency, VertexType.Dependency);
          const when: ICheckCondition = { failingSteps: [step.id] };

          if (dependency !== undefined) {
            this.explainDependency(graph, scoped, dependency, causes, list, when);
            this.corroborate(
              graph,
              dependency,
              step,
              flow.propagatesTraceContext,
              flow.correlationKey,
              list,
              when,
            );
          }
        }
      }
    } else {
      this.planWithoutFlow(graph, entry, scoped, symptom, causes, list);
    }
    this.impact(graph, scope, list);

    const { checks, omitted } = list.build(this.config.maxChecks);
    return { checks, blindSpots: this.blindSpots(graph, scope), omittedChecks: omitted };
  }

  private confirmFlows(
    graph: SystemGraph,
    scope: IInvestigationScope,
    paths: readonly IFlowPath[],
    list: CheckList,
  ): void {
    for (const { vertex } of scope.vertices) {
      if (graph.vertex(vertex)?.type === VertexType.Functionality) {
        this.indicators(
          graph,
          vertex,
          CheckTier.Confirm,
          undefined,
          list,
          'Confirms the symptom and when it started',
        );
      }
    }
    for (const { flow } of paths) {
      this.indicators(
        graph,
        flow.id,
        CheckTier.Confirm,
        undefined,
        list,
        `End to end ${flow.name}: confirms the symptom and when it started`,
      );
    }
  }

  /** The first unhealthy step, in flow order, is where the fault surfaces. */
  private localiseSteps(
    graph: SystemGraph,
    paths: readonly IFlowPath[],
    symptom: RoleFilter,
    list: CheckList,
  ): void {
    for (const { flow, steps } of paths) {
      for (const step of steps) {
        const dependency = graph.vertexOfType(step.dependency, VertexType.Dependency);
        const hop =
          dependency === undefined ? vertexKey(step.dependency) : this.hop(dependency, step);

        this.indicators(
          graph,
          step.id,
          CheckTier.Localise,
          symptom,
          list,
          `Step ${step.position} of ${flow.name}: ${hop}`,
        );
      }
    }
  }

  /**
   * Behind a failing hop: its target and the members serving it, the caller's saturation,
   * the target's own dependencies (hard, then soft), and other callers competing for it.
   */
  private explainDependency(
    graph: SystemGraph,
    scoped: ReadonlyMap<string, ScopeReason>,
    dependency: IDependencyVertex,
    causes: RoleFilter,
    list: CheckList,
    when?: ICheckCondition,
  ): void {
    const target = VertexIds.component(dependency.target);
    const caller = VertexIds.component(dependency.caller);

    this.indicators(
      graph,
      target,
      CheckTier.Explain,
      causes,
      list,
      `${dependency.target} serves the failing hop`,
      when,
    );
    this.members(graph, scoped, target, causes, list, when);
    this.indicators(
      graph,
      caller,
      CheckTier.Explain,
      SATURATION,
      list,
      `${dependency.caller} may be out of resources`,
      when,
    );

    for (const next of this.dependenciesOf(graph, scoped, target)) {
      const rationale = `${dependency.target} depends on ${next.target} (${next.criticality})`;

      this.overDependency(graph, next, causes, list, rationale, when);
      this.indicators(
        graph,
        VertexIds.component(next.target),
        CheckTier.Explain,
        causes,
        list,
        rationale,
        when,
      );
      this.members(graph, scoped, VertexIds.component(next.target), causes, list, when);
    }
    for (const other of this.contenders(graph, scoped, target, dependency.id)) {
      const rationale = `${other.caller} also uses ${dependency.target}`;

      this.overDependency(graph, other, causes, list, rationale, when);
      this.indicators(
        graph,
        VertexIds.component(other.caller),
        CheckTier.Explain,
        SATURATION,
        list,
        rationale,
        when,
      );
      this.contenderLogs(graph, other, rationale, list, when);
    }
  }

  /** A contender often has no indicators (a batch job, say); its logs may be all there is. */
  private contenderLogs(
    graph: SystemGraph,
    contender: IDependencyVertex,
    rationale: string,
    list: CheckList,
    when?: ICheckCondition,
  ): void {
    const caller = graph.vertexOfType(VertexIds.component(contender.caller), VertexType.Component);

    if (caller?.telemetry.logs !== undefined) {
      list.add({
        tier: CheckTier.Corroborate,
        kind: CheckKind.Logs,
        subject: caller.id,
        roles: [],
        when,
        rationale: `Logs of ${contender.caller}: ${rationale}`,
      });
    }
  }

  private corroborate(
    graph: SystemGraph,
    dependency: IDependencyVertex,
    step: IStepVertex | undefined,
    propagatesTraceContext: boolean,
    correlationKey: string | undefined,
    list: CheckList,
    when?: ICheckCondition,
  ): void {
    const components = [dependency.caller, dependency.target].flatMap((name) => {
      const component = graph.vertexOfType(VertexIds.component(name), VertexType.Component);
      return component === undefined ? [] : [component];
    });
    const match = step?.match;

    for (const component of components.filter(({ telemetry }) => telemetry.logs !== undefined)) {
      list.add({
        tier: CheckTier.Corroborate,
        kind: CheckKind.Logs,
        subject: component.id,
        roles: [],
        match,
        correlationKey: propagatesTraceContext ? undefined : correlationKey,
        when,
        rationale: propagatesTraceContext
          ? `Error logs of ${component.name} around the hop`
          : `Error logs of ${component.name}, joined on ${correlationKey ?? 'a shared key'} because the flow drops trace context`,
      });
    }
    if (!propagatesTraceContext) {
      return;
    }
    for (const component of components.filter(({ telemetry }) => telemetry.traces !== undefined)) {
      list.add({
        tier: CheckTier.Corroborate,
        kind: CheckKind.Traces,
        subject: component.id,
        roles: [],
        match,
        when,
        rationale: `Error spans of ${component.name} for the hop`,
      });
    }
  }

  /** A component, member or dependency entry: its own signals confirm, its dependencies localise. */
  private planWithoutFlow(
    graph: SystemGraph,
    entry: string,
    scoped: ReadonlyMap<string, ScopeReason>,
    symptom: RoleFilter,
    causes: RoleFilter,
    list: CheckList,
  ): void {
    const vertex = graph.vertex(entry);
    const confirm = 'The entry itself: confirms the symptom and when it started';

    if (vertex?.type === VertexType.Dependency) {
      this.overDependency(graph, vertex, undefined, list, confirm, undefined, CheckTier.Confirm);
      this.explainDependency(graph, scoped, vertex, causes, list);
      this.corroborate(graph, vertex, undefined, true, undefined, list);
      return;
    }
    const component =
      vertex?.type === VertexType.Member
        ? graph.vertexOfType(VertexIds.component(vertex.component), VertexType.Component)
        : graph.vertexOfType(entry, VertexType.Component);

    if (component === undefined) {
      return;
    }
    this.indicators(graph, entry, CheckTier.Confirm, undefined, list, confirm);
    this.indicators(graph, component.id, CheckTier.Confirm, undefined, list, confirm);

    for (const dependency of this.dependenciesOf(graph, scoped, component.id)) {
      const rationale = `${component.name} depends on ${dependency.target} (${dependency.criticality})`;

      this.overDependency(
        graph,
        dependency,
        symptom,
        list,
        rationale,
        undefined,
        CheckTier.Localise,
      );
      this.indicators(
        graph,
        VertexIds.component(dependency.target),
        CheckTier.Localise,
        symptom,
        list,
        rationale,
      );
    }
    this.members(graph, scoped, component.id, causes, list);

    for (const other of this.contenders(graph, scoped, component.id, undefined)) {
      const rationale = `${other.caller} also uses ${component.name}`;

      this.overDependency(graph, other, causes, list, rationale);
      this.indicators(
        graph,
        VertexIds.component(other.caller),
        CheckTier.Explain,
        SATURATION,
        list,
        rationale,
      );
      this.contenderLogs(graph, other, rationale, list);
    }
    this.corroborateComponent(component, list);
  }

  private corroborateComponent(component: IComponentVertex, list: CheckList): void {
    if (component.telemetry.logs !== undefined) {
      list.add({
        tier: CheckTier.Corroborate,
        kind: CheckKind.Logs,
        subject: component.id,
        roles: [],
        rationale: `Error logs of ${component.name}`,
      });
    }
    if (component.telemetry.traces !== undefined) {
      list.add({
        tier: CheckTier.Corroborate,
        kind: CheckKind.Traces,
        subject: component.id,
        roles: [],
        rationale: `Error spans of ${component.name}`,
      });
    }
  }

  private impact(graph: SystemGraph, scope: IInvestigationScope, list: CheckList): void {
    for (const flow of scope.impactFlows) {
      this.indicators(
        graph,
        flow,
        CheckTier.Impact,
        undefined,
        list,
        `${vertexKey(flow)} can be hit downstream`,
      );
    }
  }

  /** Indicators of every step travelling over a dependency, in any flow. */
  private overDependency(
    graph: SystemGraph,
    dependency: IDependencyVertex,
    roles: RoleFilter,
    list: CheckList,
    rationale: string,
    when?: ICheckCondition,
    tier: CheckTier = CheckTier.Explain,
  ): void {
    for (const edge of graph.incoming(dependency.id, EdgeType.Over)) {
      this.indicators(graph, edge.from, tier, roles, list, rationale, when);
    }
  }

  private members(
    graph: SystemGraph,
    scoped: ReadonlyMap<string, ScopeReason>,
    component: string,
    roles: RoleFilter,
    list: CheckList,
    when?: ICheckCondition,
  ): void {
    for (const edge of graph.incoming(component, EdgeType.MemberOf)) {
      if (scoped.has(edge.from)) {
        this.indicators(
          graph,
          edge.from,
          CheckTier.Explain,
          roles,
          list,
          `${vertexKey(edge.from)} serves the hop`,
          when,
        );
      }
    }
  }

  /** In-scope dependencies of a component, hard before soft. */
  private dependenciesOf(
    graph: SystemGraph,
    scoped: ReadonlyMap<string, ScopeReason>,
    component: string,
  ): IDependencyVertex[] {
    return graph
      .outgoing(component, EdgeType.Calls)
      .flatMap((edge) => {
        const dependency = graph.vertexOfType(edge.to, VertexType.Dependency);
        return dependency !== undefined && scoped.has(dependency.id) ? [dependency] : [];
      })
      .sort(
        (left, right) =>
          Number(left.criticality === Criticality.Soft) -
          Number(right.criticality === Criticality.Soft),
      );
  }

  /** Other callers of a component that scoping kept as contention. */
  private contenders(
    graph: SystemGraph,
    scoped: ReadonlyMap<string, ScopeReason>,
    component: string,
    except: string | undefined,
  ): IDependencyVertex[] {
    return graph.incoming(component, EdgeType.Targets).flatMap((edge) => {
      const dependency = graph.vertexOfType(edge.from, VertexType.Dependency);
      return dependency !== undefined &&
        dependency.id !== except &&
        scoped.get(dependency.id) === ScopeReason.Contention
        ? [dependency]
        : [];
    });
  }

  private indicators(
    graph: SystemGraph,
    subject: string,
    tier: CheckTier,
    allowed: RoleFilter,
    list: CheckList,
    rationale: string,
    when?: ICheckCondition,
  ): void {
    for (const indicator of graph.indicatorsOf(subject)) {
      const roles = this.roles(indicator, allowed);

      if (roles.length > 0) {
        list.indicator(tier, indicator, roles, rationale, when);
      }
    }
  }

  private roles(indicator: IIndicatorVertex, allowed: RoleFilter): IndicatorRole[] {
    return allowed === undefined
      ? [...indicator.roles]
      : indicator.roles.filter((role) => allowed.has(role));
  }

  private hop(dependency: IDependencyVertex, step: IStepVertex): string {
    const selector = describeSelector(step.match);
    const hop = `${dependency.caller} → ${dependency.target} over ${dependency.transport}`;
    return selector === '' ? hop : `${hop} (${selector})`;
  }

  /** In-scope parts with no indicator: where Heimdall cannot see, so a clean plan is not a healthy system. */
  private blindSpots(graph: SystemGraph, scope: IInvestigationScope): IBlindSpot[] {
    return scope.vertices.flatMap(({ vertex: id }) => {
      const vertex = graph.vertex(id);

      if (
        vertex === undefined ||
        !BLIND_SPOT_TYPES.has(vertex.type) ||
        graph.indicatorsOf(id).length > 0
      ) {
        return [];
      }
      const silent =
        (vertex.type === VertexType.Component || vertex.type === VertexType.Member) &&
        vertex.telemetry.logs === undefined &&
        vertex.telemetry.metrics === undefined &&
        vertex.telemetry.traces === undefined;

      return [
        { vertex: id, reason: silent ? BlindSpotReason.NoTelemetry : BlindSpotReason.NoIndicators },
      ];
    });
  }
}
