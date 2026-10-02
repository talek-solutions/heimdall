import { Inject, Injectable } from '@nestjs/common';
import {
  SystemGraphCompiler,
  VertexType,
  type IGraphVertex,
  type SystemGraph,
} from '@heimdall/core/graph';
import { IndicatorRole, type IManifestV1 } from '@heimdall/core/manifest';
import type { IInvestigationConfig } from './config/investigation-config.model';
import { EntryMethod, InvestigationEventType, SymptomMethod } from './enums';
import { AmbiguousEntryError, InvestigationError, InvestigationErrorCode } from './errors';
import type {
  IInvestigationEntry,
  IInvestigationEvent,
  IInvestigationPlan,
  IInvestigationRequest,
  IPrepareOptions,
  ISymptom,
} from './interfaces';
import { InvestigationIntake } from './intake/investigation.intake';
import { CheckPlanner } from './plan/check.planner';
import { ScopeResolver } from './scope/scope.resolver';
import { INVESTIGATION_CONFIG } from './investigation.tokens';
import { LOCATABLE_TYPES, SymptomTriage, type ITriageResult } from './triage/symptom.triage';

const ALL_ROLES: readonly IndicatorRole[] = Object.values(IndicatorRole);

/** Named entries may also be a step or a dependency, which free text never lands on. */
const NAMEABLE_TYPES: ReadonlySet<VertexType> = new Set([
  ...LOCATABLE_TYPES,
  VertexType.Step,
  VertexType.Dependency,
]);

/**
 * The init phase of an investigation (ADR 0016): from an engineer's words to an ordered
 * plan of checks. Only classification may call a model; everything else is a graph walk.
 */
@Injectable()
export class InvestigationInitService {
  constructor(
    private readonly compiler: SystemGraphCompiler,
    private readonly intake: InvestigationIntake,
    private readonly triage: SymptomTriage,
    private readonly scopes: ScopeResolver,
    private readonly planner: CheckPlanner,
    @Inject(INVESTIGATION_CONFIG) private readonly config: IInvestigationConfig,
  ) {}

  async prepare(
    manifest: IManifestV1,
    request: IInvestigationRequest,
    options: IPrepareOptions = {},
  ): Promise<IInvestigationPlan> {
    const emit = (event: IInvestigationEvent): void => options.onEvent?.(event);
    const graph = this.compiler.compile(manifest);
    const { query, environment, window } = this.intake.resolve(graph, request);

    emit({
      type: InvestigationEventType.Started,
      query,
      system: graph.system.name,
      environment,
      window,
    });

    const { symptom, entry } =
      request.entry === undefined
        ? await this.classify(graph, query, environment?.name, options)
        : this.named(graph, request.entry);

    emit({ type: InvestigationEventType.SymptomClassified, symptom });
    emit({ type: InvestigationEventType.EntryLocated, entry });

    const scope = this.scopes.resolve(graph, entry.vertex, symptom.roles);
    emit({ type: InvestigationEventType.ScopeResolved, scope });

    const { checks, blindSpots, omittedChecks } = this.planner.plan(
      graph,
      entry.vertex,
      scope,
      symptom.roles,
    );
    const plan: IInvestigationPlan = {
      query,
      system: graph.system.name,
      environment,
      window,
      symptom,
      entry,
      scope,
      checks,
      blindSpots,
      omittedChecks,
    };

    emit({ type: InvestigationEventType.PlanReady, plan });
    return plan;
  }

  private async classify(
    graph: SystemGraph,
    query: string,
    environment: string | undefined,
    options: IPrepareOptions,
  ): Promise<{ readonly symptom: ISymptom; readonly entry: IInvestigationEntry }> {
    const result = await this.triage.classify(query, graph, environment);
    const symptom: ISymptom = {
      roles: result.roles.length === 0 ? ALL_ROLES : result.roles,
      method: SymptomMethod.Model,
    };

    return { symptom, entry: await this.choose(graph, result, options) };
  }

  private async choose(
    graph: SystemGraph,
    { candidates }: ITriageResult,
    options: IPrepareOptions,
  ): Promise<IInvestigationEntry> {
    const [top, runnerUp] = candidates;

    if (top === undefined) {
      throw new InvestigationError(
        InvestigationErrorCode.EntryNotFound,
        `nothing in system ${graph.system.name} fits the report; name the entry (--entry)`,
      );
    }
    const { minConfidence, ambiguityMargin } = this.config.triage;
    const ambiguous =
      top.confidence < minConfidence ||
      (runnerUp !== undefined && top.confidence - runnerUp.confidence < ambiguityMargin);

    if (!ambiguous) {
      return this.entry(this.vertex(graph, top.vertex), EntryMethod.Model, candidates);
    }
    const chosen = await options.chooseEntry?.(candidates);
    const candidate = candidates.find(({ vertex }) => vertex === chosen);

    if (candidate === undefined) {
      throw new AmbiguousEntryError(candidates);
    }
    return this.entry(this.vertex(graph, candidate.vertex), EntryMethod.Prompt, candidates);
  }

  private named(
    graph: SystemGraph,
    vertex: string,
  ): { readonly symptom: ISymptom; readonly entry: IInvestigationEntry } {
    return {
      symptom: { roles: ALL_ROLES, method: SymptomMethod.Unclassified },
      entry: this.entry(this.vertex(graph, vertex), EntryMethod.Flag, []),
    };
  }

  private vertex(graph: SystemGraph, id: string): IGraphVertex {
    const vertex = graph.vertex(id);

    if (vertex === undefined || !NAMEABLE_TYPES.has(vertex.type)) {
      throw new InvestigationError(
        InvestigationErrorCode.EntryNotFound,
        `'${id}' is not a functionality, flow, step, dependency, component or member of system ${graph.system.name}; ids look like component:checkout`,
      );
    }
    return vertex;
  }

  private entry(
    vertex: IGraphVertex,
    method: EntryMethod,
    candidates: IInvestigationEntry['candidates'],
  ): IInvestigationEntry {
    const candidate = candidates.find((option) => option.vertex === vertex.id);

    return {
      vertex: vertex.id,
      type: vertex.type,
      method,
      confidence: candidate?.confidence,
      reason: candidate?.reason,
      candidates,
    };
  }
}
