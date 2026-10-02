import { Inject, Injectable } from '@nestjs/common';
import {
  EdgeType,
  VertexIds,
  VertexType,
  type IDependencyVertex,
  type IFlowPath,
  type IMemberVertex,
  type ISemanticSelector,
  type SystemGraph,
} from '@heimdall/core/graph';
import {
  IndicatorRole,
  InteractionMode,
  MemberRole,
  ReplicaRouting,
} from '@heimdall/core/manifest';
import type { IInvestigationConfig } from '../config/investigation-config.model';
import { PruneReason, ScopeReason } from '../enums';
import type { IInvestigationScope } from '../interfaces';
import { INVESTIGATION_CONFIG } from '../investigation.tokens';

const WRITE_OPERATION =
  /^(INSERT|UPDATE|DELETE|UPSERT|REPLACE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i;

const PRUNABLE_TYPES: ReadonlySet<VertexType> = new Set([
  VertexType.Functionality,
  VertexType.Flow,
  VertexType.Dependency,
  VertexType.Component,
  VertexType.Member,
]);

/** Edges that make a dropped vertex a near miss rather than unrelated. */
const STRUCTURAL_EDGES: ReadonlySet<EdgeType> = new Set([
  EdgeType.Calls,
  EdgeType.Targets,
  EdgeType.MemberOf,
]);

const REPLICATED_ROLES: ReadonlySet<MemberRole> = new Set([MemberRole.Primary, MemberRole.Replica]);

/** Scoped vertices in the order they were reached; the first reason wins. */
class ScopeState {
  readonly scoped = new Map<string, ScopeReason>();
  readonly notRouted = new Set<string>();
  readonly pathComponents = new Set<string>();

  add(vertex: string, reason: ScopeReason): void {
    if (!this.scoped.has(vertex)) {
      this.scoped.set(vertex, reason);
    }
  }

  has(vertex: string): boolean {
    return this.scoped.has(vertex);
  }
}

/**
 * Which parts of the system could cause the symptom (ADR 0016). Every rule reads a manifest
 * field; nothing here looks at telemetry.
 */
@Injectable()
export class ScopeResolver {
  constructor(@Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig) {}

  resolve(graph: SystemGraph, entry: string, roles: readonly IndicatorRole[]): IInvestigationScope {
    const state = new ScopeState();
    const { suspects, impactFlows } = this.flows(graph, entry, roles);

    state.add(entry, ScopeReason.Entry);
    this.realisers(graph, suspects, state);

    for (const { flow, steps } of suspects) {
      state.add(flow.id, ScopeReason.SuspectFlow);

      for (const step of steps) {
        const dependency = graph.vertexOfType(step.dependency, VertexType.Dependency);

        state.add(step.id, ScopeReason.Step);
        if (dependency !== undefined) {
          this.addPath(graph, dependency, step.match, state);
        }
      }
    }
    if (suspects.length === 0) {
      this.addEntryWithoutFlow(graph, entry, state);
    }
    this.expand(graph, state);

    return {
      suspectFlows: suspects.map(({ flow }) => flow.id),
      impactFlows,
      vertices: [...state.scoped].map(([vertex, reason]) => ({ vertex, reason })),
      pruned: this.pruned(graph, state, impactFlows),
    };
  }

  /**
   * Sync flows are suspects: an async flow starts after the user's request succeeded, so it
   * is impact only. When the symptom is lag, async flows are suspects too.
   */
  private flows(
    graph: SystemGraph,
    entry: string,
    roles: readonly IndicatorRole[],
  ): { readonly suspects: IFlowPath[]; readonly impactFlows: string[] } {
    const vertex = graph.vertex(entry);

    switch (vertex?.type) {
      case VertexType.Functionality: {
        const paths = graph.path(entry);
        const lag = roles.includes(IndicatorRole.Lag);
        const sync = paths.filter(({ flow }) => lag || flow.mode === InteractionMode.Sync);
        const suspects = sync.length === 0 ? paths : sync;

        return {
          suspects,
          impactFlows: paths.filter((path) => !suspects.includes(path)).map(({ flow }) => flow.id),
        };
      }
      case VertexType.Flow:
        return { suspects: graph.path(entry), impactFlows: [] };
      case VertexType.Step:
        return { suspects: graph.path(VertexIds.flow(vertex.flow)), impactFlows: [] };
      case undefined:
        return { suspects: [], impactFlows: [] };
      default:
        return { suspects: [], impactFlows: [...graph.impact(entry).flows] };
    }
  }

  /** Functionalities realising a suspect flow: their KPIs confirm the symptom. */
  private realisers(graph: SystemGraph, suspects: readonly IFlowPath[], state: ScopeState): void {
    for (const { flow } of suspects) {
      for (const edge of graph.incoming(flow.id, EdgeType.RealizedBy)) {
        state.add(edge.from, ScopeReason.Functionality);
      }
    }
  }

  private addPath(
    graph: SystemGraph,
    dependency: IDependencyVertex,
    match: ISemanticSelector | undefined,
    state: ScopeState,
  ): void {
    const caller = VertexIds.component(dependency.caller);
    const target = VertexIds.component(dependency.target);

    state.add(dependency.id, ScopeReason.PathDependency);
    state.add(caller, ScopeReason.PathComponent);
    state.add(target, ScopeReason.PathComponent);
    state.pathComponents.add(caller);
    state.pathComponents.add(target);
    this.route(graph, dependency, match, state);
  }

  /** A component, member or dependency entry: its own dependencies are the path. */
  private addEntryWithoutFlow(graph: SystemGraph, entry: string, state: ScopeState): void {
    const vertex = graph.vertex(entry);

    if (vertex?.type === VertexType.Dependency) {
      this.addPath(graph, vertex, undefined, state);
      return;
    }
    const component =
      vertex?.type === VertexType.Member
        ? VertexIds.component(vertex.component)
        : vertex?.type === VertexType.Component
          ? vertex.id
          : undefined;

    if (component === undefined) {
      return;
    }
    state.add(component, ScopeReason.PathComponent);
    state.pathComponents.add(component);
    this.members(graph, component).forEach((member) =>
      state.add(member.id, ScopeReason.RoutedMember),
    );

    for (const edge of graph.outgoing(component, EdgeType.Calls)) {
      const dependency = graph.vertexOfType(edge.to, VertexType.Dependency);

      if (dependency !== undefined) {
        this.addPath(graph, dependency, undefined, state);
      }
    }
  }

  /**
   * Neighbours (other dependencies, hard and soft alike) and contention (other callers) of
   * path components, repeated for each hop of the budget.
   */
  private expand(graph: SystemGraph, state: ScopeState): void {
    let frontier = [...state.pathComponents];
    const expanded = new Set<string>();

    for (let hop = 1; hop <= this.config.hopBudget; hop += 1) {
      const next: string[] = [];

      for (const component of frontier.filter((id) => !expanded.has(id))) {
        expanded.add(component);

        for (const edge of graph.outgoing(component, EdgeType.Calls)) {
          const dependency = graph.vertexOfType(edge.to, VertexType.Dependency);

          if (dependency !== undefined && !state.has(dependency.id)) {
            const target = VertexIds.component(dependency.target);

            state.add(dependency.id, ScopeReason.Neighbour);
            state.add(target, ScopeReason.Neighbour);
            this.route(graph, dependency, undefined, state);
            next.push(target);
          }
        }
        for (const edge of graph.incoming(component, EdgeType.Targets)) {
          const dependency = graph.vertexOfType(edge.from, VertexType.Dependency);

          if (dependency !== undefined && !state.has(dependency.id)) {
            const caller = VertexIds.component(dependency.caller);

            state.add(dependency.id, ScopeReason.Contention);
            state.add(caller, ScopeReason.Contention);
            next.push(caller);
          }
        }
      }
      frontier = next;
    }
  }

  /** Keeps the target's members that serve the dependency's reads or writes. */
  private route(
    graph: SystemGraph,
    dependency: IDependencyVertex,
    match: ISemanticSelector | undefined,
    state: ScopeState,
  ): void {
    const members = this.members(graph, VertexIds.component(dependency.target));
    const replicated = members.some((member) => REPLICATED_ROLES.has(member.role));
    const operations = match?.operation === undefined ? dependency.operations : [match.operation];
    const unknown = operations.length === 0;
    const routes = new Set<ReplicaRouting>([
      ...(unknown || operations.some((operation) => WRITE_OPERATION.test(operation))
        ? [dependency.writeTo ?? ReplicaRouting.Primary]
        : []),
      ...(unknown || operations.some((operation) => !WRITE_OPERATION.test(operation))
        ? [dependency.readFrom ?? ReplicaRouting.Primary]
        : []),
    ]);

    for (const member of members) {
      const served =
        !replicated ||
        !REPLICATED_ROLES.has(member.role) ||
        (member.role === MemberRole.Primary && routes.has(ReplicaRouting.Primary)) ||
        (member.role === MemberRole.Replica && routes.has(ReplicaRouting.Replicas));

      if (served) {
        state.add(member.id, ScopeReason.RoutedMember);
        state.notRouted.delete(member.id);
      } else if (!state.has(member.id)) {
        state.notRouted.add(member.id);
      }
    }
  }

  private members(graph: SystemGraph, component: string): IMemberVertex[] {
    return graph.incoming(component, EdgeType.MemberOf).flatMap((edge) => {
      const member = graph.vertexOfType(edge.from, VertexType.Member);
      return member === undefined ? [] : [member];
    });
  }

  private pruned(
    graph: SystemGraph,
    state: ScopeState,
    impactFlows: readonly string[],
  ): IInvestigationScope['pruned'] {
    const impact = new Set(impactFlows);
    const realisesImpact = (id: string): boolean =>
      graph.outgoing(id, EdgeType.RealizedBy).some((edge) => impact.has(edge.to));

    return graph.vertices
      .filter(
        ({ id, type }) =>
          PRUNABLE_TYPES.has(type) && !state.has(id) && !impact.has(id) && !realisesImpact(id),
      )
      .map(({ id }) => ({
        vertex: id,
        reason: state.notRouted.has(id)
          ? PruneReason.NotRouted
          : this.adjacent(graph, id, state)
            ? PruneReason.BeyondHopBudget
            : PruneReason.Unreachable,
      }));
  }

  private adjacent(graph: SystemGraph, id: string, state: ScopeState): boolean {
    return [...graph.outgoing(id), ...graph.incoming(id)].some(
      (edge) =>
        STRUCTURAL_EDGES.has(edge.type) && state.has(edge.from === id ? edge.to : edge.from),
    );
  }
}
