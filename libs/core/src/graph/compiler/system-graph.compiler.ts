import { Injectable } from '@nestjs/common';
import { MemberRole, TopologyMode } from '../../manifest/enums';
import type { IComponentV1, IFlowV1, IManifestV1 } from '../../manifest/interfaces/v1';
import { EdgeType, VertexType } from '../enums';
import type { IGraphEdge, IGraphVertex } from '../interfaces';
import { SystemGraph } from '../system-graph';
import { VertexIds, vertexId } from '../vertex-id';
import { IndicatorDeriver } from './indicator.deriver';

type Link = (type: EdgeType, from: string, to: string) => void;

/** Compiles a validated manifest into the property graph of ADR 0015. */
@Injectable()
export class SystemGraphCompiler {
  private readonly deriver = new IndicatorDeriver();

  compile(manifest: IManifestV1): SystemGraph {
    const vertices: IGraphVertex[] = [];
    const edges: IGraphEdge[] = [];
    const link: Link = (type, from, to) => {
      edges.push({ type, from, to });
    };

    for (const functionality of manifest.functionalities) {
      const id = VertexIds.functionality(functionality.metadata.name);

      vertices.push({
        id,
        type: VertexType.Functionality,
        name: functionality.metadata.name,
        description: functionality.spec.description,
      });
      for (const flow of functionality.spec.flows) {
        link(EdgeType.RealizedBy, id, VertexIds.flow(flow));
      }
    }
    for (const flow of manifest.flows) {
      this.addFlow(flow, vertices, link);
    }
    for (const component of manifest.components) {
      this.addComponent(component, vertices, link);
    }
    this.addIndicators(manifest, vertices, link);

    const { name } = manifest.system.metadata;
    const { description, environments } = manifest.system.spec;
    return new SystemGraph({ name, description, environments }, vertices, edges);
  }

  private addFlow(flow: IFlowV1, vertices: IGraphVertex[], link: Link): void {
    const name = flow.metadata.name;
    const id = VertexIds.flow(name);

    vertices.push({
      id,
      type: VertexType.Flow,
      name,
      mode: flow.spec.mode,
      propagatesTraceContext: flow.spec.propagatesTraceContext,
      correlationKey: flow.spec.correlationKey,
      description: flow.spec.description,
    });
    flow.spec.steps.forEach((step, offset) => {
      const position = offset + 1;
      const stepId = VertexIds.step(name, position);
      const dependencyId = vertexId(VertexType.Dependency, step.dependency);

      vertices.push({
        id: stepId,
        type: VertexType.Step,
        flow: name,
        position,
        dependency: dependencyId,
        match: step.match,
        description: step.description,
      });
      link(EdgeType.HasStep, id, stepId);
      link(EdgeType.Over, stepId, dependencyId);

      if (position > 1) {
        link(EdgeType.Next, VertexIds.step(name, position - 1), stepId);
      }
    });
  }

  private addComponent(component: IComponentV1, vertices: IGraphVertex[], link: Link): void {
    const name = component.metadata.name;
    const id = VertexIds.component(name);
    const { spec } = component;

    vertices.push({
      id,
      type: VertexType.Component,
      name,
      componentType: spec.type,
      engine: spec.engine,
      description: spec.description,
      telemetry: spec.telemetry,
    });

    for (const dependency of spec.dependsOn) {
      const dependencyId = VertexIds.dependency(name, dependency.name);

      vertices.push({
        id: dependencyId,
        type: VertexType.Dependency,
        caller: name,
        name: dependency.name,
        target: dependency.target,
        transport: dependency.transport,
        mode: dependency.mode,
        criticality: dependency.criticality,
        operations: dependency.operations,
        topic: dependency.topic,
        consumerGroup: dependency.consumerGroup,
        role: dependency.role,
        writeTo: dependency.writeTo,
        readFrom: dependency.readFrom,
        config: dependency.config,
        description: dependency.description,
      });
      link(EdgeType.Calls, id, dependencyId);
      link(EdgeType.Targets, dependencyId, VertexIds.component(dependency.target));
    }

    const members = spec.topology?.members ?? [];
    for (const member of members) {
      const memberId = VertexIds.member(name, member.name);

      vertices.push({
        id: memberId,
        type: VertexType.Member,
        component: name,
        name: member.name,
        role: member.role,
        telemetry: member.telemetry,
      });
      link(EdgeType.MemberOf, memberId, id);
    }

    const primary = members.find((member) => member.role === MemberRole.Primary);

    if (spec.topology?.mode === TopologyMode.PrimaryReplica && primary !== undefined) {
      const primaryId = VertexIds.member(name, primary.name);

      for (const replica of members.filter((member) => member.role === MemberRole.Replica)) {
        link(EdgeType.ReplicatesTo, primaryId, VertexIds.member(name, replica.name));
      }
    }
  }

  private addIndicators(manifest: IManifestV1, vertices: IGraphVertex[], link: Link): void {
    const ordinals = new Map<string, number>();

    for (const draft of this.deriver.derive(manifest)) {
      const ordinal = (ordinals.get(draft.subject) ?? 0) + 1;
      const id = VertexIds.indicator(draft.subject, ordinal);

      ordinals.set(draft.subject, ordinal);
      vertices.push({ id, type: VertexType.Indicator, ...draft });
      link(EdgeType.Measures, id, draft.subject);
    }
  }
}
